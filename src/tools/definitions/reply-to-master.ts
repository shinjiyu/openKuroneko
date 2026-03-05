import type { Tool } from '../index.js';

/**
 * reply_to_master — 将内容写入主端点 output。
 * 实际写入由 Runner 注入的 writeOutput 函数完成。
 */
let _writeOutput: ((content: string) => Promise<void>) | null = null;

export function setReplyWriter(fn: (content: string) => Promise<void>): void {
  _writeOutput = fn;
}

export const replyToMasterTool: Tool = {
  name: 'reply_to_master',
  description:
    'Send a reply to the master (human user) via the main output endpoint. ' +
    'Call this ONCE per turn to deliver your response. Do not call it again after it succeeds.',
  parameters: {
    message: { type: 'string', description: 'The reply content to send to the master' },
  },
  required: ['message'],
  async call(args) {
    const message = String(args['message'] ?? '');
    if (!message) return { ok: false, output: 'Missing required argument: message' };
    if (!_writeOutput) return { ok: false, output: 'reply_to_master: output writer not initialized' };
    await _writeOutput(message);
    return { ok: true, output: `Replied: ${message.slice(0, 80)}` };
  },
};
