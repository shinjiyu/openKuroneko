import type { LLMAdapter, LLMResult, Message } from './index.js';

interface OpenAIToolCall {
  function: { name: string; arguments: string };
}

interface OpenAIChoice {
  message: {
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
}

export function createOpenAIAdapter(options?: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): LLMAdapter {
  const apiKey = options?.apiKey ?? process.env['OPENAI_API_KEY'] ?? '';
  const baseUrl = options?.baseUrl ?? process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1';
  const model = options?.model ?? process.env['OPENAI_MODEL'] ?? 'gpt-4o';

  return {
    async chat(systemPrompt, messages, tools): Promise<LLMResult> {
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
      };
      if (tools && tools.length > 0) {
        body['tools'] = tools;
        body['tool_choice'] = 'auto';
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as OpenAIResponse;
      const choice = data.choices[0];
      if (!choice) throw new Error('No choices returned from OpenAI API');

      const content = choice.message.content ?? '';
      const toolCalls = (choice.message.tool_calls ?? []).map((tc) => ({
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      }));

      return { content, toolCalls };
    },
  };
}
