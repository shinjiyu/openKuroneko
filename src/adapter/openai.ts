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

// ── Adapter factory ───────────────────────────────────────────────────────────

export function createOpenAIAdapter(options?: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): LLMAdapter {
  const apiKey  = options?.apiKey  ?? process.env['OPENAI_API_KEY']  ?? '';
  const baseUrl = options?.baseUrl ?? process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1';
  const model   = options?.model   ?? process.env['OPENAI_MODEL']    ?? 'gpt-4o';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  function buildBody(
    systemPrompt: string,
    messages: Message[],
    tools?: object[],
    stream = false
  ): string {
    const body: Record<string, unknown> = {
      model,
      stream,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
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
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: buildBody(systemPrompt, messages, tools, false),
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
    }

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
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: buildBody(systemPrompt, messages, undefined, true),
    });

    if (!res.ok) {
      throw new Error(`OpenAI stream error ${res.status}: ${await res.text()}`);
    }
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
