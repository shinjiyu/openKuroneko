import type { LLMAdapter, LLMResult, StreamChunk, Message } from './index.js';

// ── OpenAI wire types ─────────────────────────────────────────────────────────

interface OAIToolCall {
  index?: number;
  id?: string;
  function: { name: string; arguments: string };
}

interface OAIChoice {
  message: { content: string | null; tool_calls?: OAIToolCall[] };
}

interface OAIResponse {
  choices: OAIChoice[];
}

interface OAIStreamDelta {
  content?: string | null;
  tool_calls?: Array<{ index: number; function: { name?: string; arguments?: string } }>;
}

interface OAIStreamChunk {
  choices: Array<{ delta: OAIStreamDelta; finish_reason: string | null }>;
}

/** 单次 LLM HTTP 请求超时（毫秒）。默认 120s，可通过 LLM_TIMEOUT_MS 环境变量覆盖。 */
const LLM_TIMEOUT_MS = parseInt(process.env['LLM_TIMEOUT_MS'] ?? '120000', 10);

// ── Retry 配置 ────────────────────────────────────────────────────────────────

/** 可自动重试的 HTTP 状态码（速率限制 & 服务端瞬时错误）。 */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** 最大重试次数（不含首次调用）。 */
const LLM_MAX_RETRIES = parseInt(process.env['LLM_MAX_RETRIES'] ?? '4', 10);

/**
 * 计算第 attempt 次（0-indexed）重试前的等待时间（毫秒）。
 *
 * - 429 速率限制：初始 10s，指数退避，上限 120s
 * - 5xx 服务端错误：初始 2s，指数退避，上限 30s
 *
 * 若响应头含 Retry-After，则取其值与计算值的较大者。
 */
function calcRetryDelay(status: number, attempt: number, retryAfterHeader: string | null): number {
  const base   = status === 429 ? 10_000 : 2_000;
  const cap    = status === 429 ? 120_000 : 30_000;
  const jitter = Math.random() * 1000;                     // ±1s 抖动
  let delay  = Math.min(base * Math.pow(2, attempt), cap) + jitter;

  // 优先尊重服务端 Retry-After 指示（秒 → 毫秒）
  if (retryAfterHeader) {
    const headerSec = parseInt(retryAfterHeader, 10);
    if (!isNaN(headerSec) && headerSec > 0) {
      delay = Math.max(delay, headerSec * 1000);
    }
  }
  return delay;
}

/**
 * 带指数退避重试的 fetch 封装。
 * 遇到 RETRYABLE_STATUSES 中的状态码时自动等待并重试，超出次数后抛出错误。
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res;

    const isRetryable = RETRYABLE_STATUSES.has(res.status);
    // 非重试状态码，或已超出重试次数 → 直接抛出
    if (!isRetryable || attempt >= LLM_MAX_RETRIES) {
      const body = await res.text();
      throw new Error(`${label} error ${res.status}: ${body}`);
    }

    const retryAfter = res.headers.get('Retry-After');
    // 必须消耗响应体，否则连接不会被释放
    await res.text();

    const waitMs = calcRetryDelay(res.status, attempt, retryAfter);
    console.warn(
      `[llm-retry] HTTP ${res.status} (${label}), attempt ${attempt + 1}/${LLM_MAX_RETRIES}, ` +
      `waiting ${Math.round(waitMs / 1000)}s before retry…`,
    );
    await new Promise<void>((r) => setTimeout(r, waitMs));
  }
  throw new Error(`${label} failed after ${LLM_MAX_RETRIES} retries`);
}

// ── Adapter factory ───────────────────────────────────────────────────────────

export function createOpenAIAdapter(options?: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /**
   * 附加到请求 body 的额外参数。
   * 例如 ZhipuAI 关闭思考：{ enable_thinking: false }
   */
  extraBody?: Record<string, unknown>;
}): LLMAdapter {
  const apiKey  = options?.apiKey  ?? process.env['OPENAI_API_KEY']  ?? '';
  const baseUrl = options?.baseUrl ?? process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1';
  const model   = options?.model   ?? process.env['OPENAI_MODEL']    ?? 'gpt-4o';
  const extraBody = options?.extraBody ?? {};

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  /**
   * OpenAI 对 tool/assistant role 的 content 要求是 string | null；
   * 只有 user role 允许 ContentBlock[]（视觉输入）。
   * 此处规范化：非 user role 的 array content 强制合并为纯文本。
   */
  function normalizeMessages(messages: Message[]): object[] {
    return messages.map((m) => {
      if (typeof m.content === 'string' || m.role === 'user') return m;
      // tool / assistant role: flatten content blocks to text
      const text = (m.content as import('./index.js').ContentBlock[])
        .map((b) => (b.type === 'text' ? b.text : '[image]'))
        .join('\n');
      return { role: m.role, content: text };
    });
  }

  function buildBody(
    systemPrompt: string,
    messages: Message[],
    tools?: object[],
    stream = false
  ): string {
    const body: Record<string, unknown> = {
      model,
      stream,
      ...extraBody,
      messages: [
        { role: 'system', content: systemPrompt },
        ...normalizeMessages(messages),
      ],
    };
    if (tools && tools.length > 0) {
      body['tools'] = tools;
      body['tool_choice'] = 'auto';
    }
    return JSON.stringify(body);
  }

  // ── Non-streaming chat ──────────────────────────────────────────────────────
  async function chat(
    systemPrompt: string,
    messages: Message[],
    tools?: object[]
  ): Promise<LLMResult> {
    const res = await fetchWithRetry(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers,
        body: buildBody(systemPrompt, messages, tools, false),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      },
      'chat',
    );

    const data = (await res.json()) as OAIResponse;
    const choice = data.choices[0];
    if (!choice) throw new Error('No choices returned from OpenAI API');

    const content = choice.message.content ?? '';
    const toolCalls = (choice.message.tool_calls ?? []).map((tc) => ({
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return { content, toolCalls };
  }

  // ── Streaming chat (SSE) ────────────────────────────────────────────────────
  async function stream(
    systemPrompt: string,
    messages: Message[],
    onChunk: (chunk: StreamChunk) => void
  ): Promise<LLMResult> {
    const res = await fetchWithRetry(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers,
        body: buildBody(systemPrompt, messages, undefined, true),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      },
      'stream',
    );
    if (!res.body) throw new Error('No response body for streaming');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    let fullContent = '';
    // Accumulate streamed tool call fragments
    const toolCallAccum: Map<number, { name: string; args: string }> = new Map();

    let buf = '';
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? ''; // last may be incomplete

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const json = trimmed.slice(5).trim();
        if (json === '[DONE]') {
          onChunk({ delta: '', done: true });
          continue;
        }
        try {
          const chunk = JSON.parse(json) as OAIStreamChunk;
          const choice = chunk.choices[0];
          if (!choice) continue;

          const delta = choice.delta;

          // Accumulate text content
          if (delta.content) {
            fullContent += delta.content;
            onChunk({ delta: delta.content, done: false });
          }

          // Accumulate tool call fragments
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCallAccum.get(tc.index) ?? { name: '', args: '' };
              existing.name += tc.function.name ?? '';
              existing.args += tc.function.arguments ?? '';
              toolCallAccum.set(tc.index, existing);
            }
          }
        } catch { /* malformed JSON chunk — skip */ }
      }
    }

    const toolCalls = [...toolCallAccum.values()].map((tc) => ({
      name: tc.name,
      args: (() => {
        try { return JSON.parse(tc.args) as Record<string, unknown>; }
        catch { return {} as Record<string, unknown>; }
      })(),
    }));

    return { content: fullContent, toolCalls };
  }

  return { chat, stream };
}
