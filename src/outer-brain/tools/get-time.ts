import type { ObTool } from './types.js';

export const obGetTimeTool: ObTool = {
  name: 'get_time',
  description: '获取当前时间（ISO 8601 格式）。',
  parameters: {},
  async call(): Promise<{ ok: boolean; output: string }> {
    return { ok: true, output: new Date().toISOString() };
  },
};
