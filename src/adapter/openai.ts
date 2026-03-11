import type { LLMAdapter, LLMResult, StreamChunk, Message, ContentBlock } from './index.js';

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
  tool_calls?: Array<{ index: number; id?: string; function: { name?: string; arguments?: string } }>;
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

/**
 * 工具调用在请求体中的线格式，不同模型要求不同：
 * - openai: 要求 assistant 消息带 tool_calls（含 id），tool 消息带 tool_call_id（OpenAI/Kimi）
 * - minimal: assistant 仅 content，tool 带 tool_call_id（GLM 等，与旧版行为一致）
 */
export type ToolWireFormat = 'openai' | 'minimal';

export function createOpenAIAdapter(options?: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /**
   * 工具调用的线格式。minimal=兼容 GLM（不往 assistant 写 tool_calls）；openai=OpenAI/Kimi 严格格式。
   * 也可通过环境变量 OPENAI_TOOL_WIRE_FORMAT=openai|minimal 设置，默认 minimal 以保持 GLM 兼容。
   */
  toolWireFormat?: ToolWireFormat;
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
  const explicitWire = options?.toolWireFormat ?? (process.env['OPENAI_TOOL_WIRE_FORMAT'] as ToolWireFormat | undefined);
  const toolWireFormat: ToolWireFormat =
    explicitWire ??
    (baseUrl.includes('moonshot') || baseUrl.includes('openai.com') ? 'openai' : 'minimal');
  if (process.env['DEBUG_LLM'] === '1') {
    console.warn('[DEBUG_LLM] adapter toolWireFormat=', toolWireFormat, 'baseUrl=', baseUrl);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  /** 请求中是否包含 user 消息的 image_url block（用于 400 时决定是否用纯文本重试） */
  function hasImageInMessages(messages: Message[]): boolean {
    return messages.some((m) => {
      if (m.role !== 'user' || !Array.isArray(m.content)) return false;
      return (m.content as ContentBlock[]).some((b) => b.type === 'image_url');
    });
  }

  /** 将 user 消息中的 ContentBlock[] 压成纯文本（image_url → [图片]），用于接口不支持多模态时的降级重试 */
  function flattenUserContentToText(messages: Message[]): Message[] {
    return messages.map((m) => {
      if (m.role !== 'user' || typeof m.content === 'string') return m;
      const blocks = m.content as ContentBlock[];
      const text = blocks
        .map((b) => (b.type === 'text' ? b.text : '[图片]'))
        .join('\n');
      return { ...m, content: text };
    });
  }

  /**
   * 按 toolWireFormat 序列化消息：
   * - openai: assistant 带 tool_calls，tool 带 tool_call_id（OpenAI/Kimi 要求）
   * - minimal: assistant 仅 content（兼容 GLM），tool 仍带 tool_call_id
   * 部分 API（如 Kimi）要求 assistant 有 tool_calls 时 content 为 null。
   */
  function normalizeMessages(messages: Message[]): object[] {
    return messages.map((m) => {
      let content: string | null;
      if (m.role === 'user') {
        return m;
      }
      if (typeof m.content === 'string') {
        content = m.content;
      } else if (Array.isArray(m.content)) {
        content = (m.content as import('./index.js').ContentBlock[])
          .map((b) => (b.type === 'text' ? b.text : '[image]'))
          .join('\n');
      } else {
        content = '';
      }
      const out: Record<string, unknown> = { role: m.role, content };
      if (m.role === 'assistant' && m.tool_calls?.length && toolWireFormat === 'openai') {
        out['content'] = content || null;
        out['tool_calls'] = m.tool_calls;
        if (process.env['DEBUG_LLM'] === '1') {
          console.warn('[DEBUG_LLM] sending assistant with tool_calls ids:', m.tool_calls.map((t) => t.id));
        }
      }
      if (m.role === 'tool' && m.tool_call_id) out['tool_call_id'] = m.tool_call_id;
      return out;
    });
  }

  function buildBody(
    systemPrompt: string,
    messages: Message[],
    tools?: object[],
    stream = false
  ): string {
    const normalized = normalizeMessages(messages);
    // #region agent log — 多模态：确认发往 API 的 user 消息是否带 image_url block
    const lastUser = [...normalized].reverse().find((x: { role?: string }) => x.role === 'user');
    const c = lastUser && typeof (lastUser as Message).content !== 'string' && Array.isArray((lastUser as Message).content)
      ? (lastUser as Message).content as import('./index.js').ContentBlock[]
      : null;
    if (c) {
      const blockTypes = c.map((b: { type: string }) => b.type);
      fetch('http://127.0.0.1:7785/ingest/d572a1ed-243c-4a7d-85e3-c51a2c7aed1a', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7d0410' }, body: JSON.stringify({ sessionId: '7d0410', hypothesisId: 'LLM_multimodal', location: 'openai.ts:buildBody', message: 'user content blocks sent to API', data: { blockCount: c.length, blockTypes }, timestamp: Date.now() }) }).catch(() => {});
    }
    // #endregion
    const body: Record<string, unknown> = {
      model,
      stream,
      ...extraBody,
      messages: [
        { role: 'system', content: systemPrompt },
        ...normalized,
      ],
    };
    if (tools && tools.length > 0) {
      body['tools'] = tools;
      body['tool_choice'] = 'auto';
    }
    if (baseUrl.includes('moonshot') && body['thinking'] === undefined) {
      body['thinking'] = { type: 'disabled' };
    }
    return JSON.stringify(body);
  }

  // ── Non-streaming chat ──────────────────────────────────────────────────────
  async function doChat(
    systemPrompt: string,
    messages: Message[],
    tools: object[] | undefined,
    isVisionFallbackRetry: boolean,
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

    const rawToolCalls = choice.message.tool_calls ?? [];
    if (process.env['DEBUG_LLM'] === '1' && rawToolCalls.length > 0) {
      console.warn('[DEBUG_LLM] response tool_calls:', JSON.stringify(rawToolCalls, null, 2));
    }

    const content = choice.message.content ?? '';
    const toolCalls = rawToolCalls.map((tc, idx) => {
      const rawId = tc.id?.trim();
      const id = rawId || `call_${Math.random().toString(36).slice(2)}`;
      if (!rawId && process.env['DEBUG_LLM'] === '1') {
        console.warn('[DEBUG_LLM] tool_calls[' + idx + '] had no id from API, using fallback:', id);
      }
      return {
        id,
        name: tc.function.name,
        args: (() => {
          try {
            return JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            return {} as Record<string, unknown>;
          }
        })(),
      };
    });

    return { content, toolCalls };
  }

  async function chat(
    systemPrompt: string,
    messages: Message[],
    tools?: object[],
  ): Promise<LLMResult> {
    try {
      return await doChat(systemPrompt, messages, tools, false);
    } catch (e) {
      const errMsg = String(e);
      // 接口返回 400/1210 且请求含图时：用纯文本（图→[图片]）重试一次，避免带图不回复
      if (
        !errMsg.includes('400') ||
        (!errMsg.includes('1210') && !errMsg.includes('参数有误')) ||
        !hasImageInMessages(messages)
      ) {
        throw e;
      }
      return doChat(systemPrompt, flattenUserContentToText(messages), tools, true);
    }
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
    const toolCallAccum: Map<number, { id: string; name: string; args: string }> = new Map();

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

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCallAccum.get(tc.index) ?? { id: '', name: '', args: '' };
              if (tc.id) existing.id = tc.id;
              existing.name += tc.function.name ?? '';
              existing.args += tc.function.arguments ?? '';
              toolCallAccum.set(tc.index, existing);
            }
          }
        } catch { /* malformed JSON chunk — skip */ }
      }
    }

    const toolCalls = [...toolCallAccum.values()].map((tc) => ({
      id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
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
