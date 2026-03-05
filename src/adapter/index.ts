/**
 * M10 · LLM Adapter
 *
 * 抽象 LLM 调用接口，屏蔽具体 provider 差异。
 * 默认实现：OpenAI Chat Completions API。
 */

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface LLMResult {
  content: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
}

export interface LLMAdapter {
  chat(
    systemPrompt: string,
    messages: Message[],
    tools?: object[]
  ): Promise<LLMResult>;
}

export { createOpenAIAdapter } from './openai.js';
