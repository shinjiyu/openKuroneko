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

export interface StreamChunk {
  /** 新增的文本片段（delta） */
  delta: string;
  /** 本 chunk 是否为最后一个 */
  done: boolean;
}

export interface LLMAdapter {
  /** 非流式：等待完整响应 */
  chat(
    systemPrompt: string,
    messages: Message[],
    tools?: object[]
  ): Promise<LLMResult>;

  /** 流式：逐 chunk 回调，返回最终完整结果 */
  stream?(
    systemPrompt: string,
    messages: Message[],
    onChunk: (chunk: StreamChunk) => void
  ): Promise<LLMResult>;
}

export { createOpenAIAdapter } from './openai.js';
