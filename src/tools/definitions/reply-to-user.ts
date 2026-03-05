import type { Tool } from '../index.js';

/**
 * reply_to_user — 将内容写入主端点 output。
 * 实际写入由 Runner 注入的 writeOutput 函数完成。
 */
let _writeOutput: ((content: string) => Promise<void>) | null = null;

export function setReplyWriter(fn: (content: string) => Promise<void>): void {
  _writeOutput = fn;
}

export const replyToUserTool: Tool = {
  name: 'reply_to_user',
  description: 'Write a reply to the user via the main output endpoint.',
  async call(args) {
    const message = String(args['message'] ?? '');
    if (!message) return { ok: false, output: 'Missing required argument: message' };
    if (!_writeOutput) return { ok: false, output: 'reply_to_user: output writer not initialized' };
    await _writeOutput(message);
    return { ok: true, output: `Replied: ${message.slice(0, 80)}` };
  },
};
