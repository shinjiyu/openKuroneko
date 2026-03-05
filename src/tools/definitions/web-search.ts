import type { Tool } from '../index.js';

/** 占位实现，后续接入实际搜索 API */
export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web for information. Returns a brief summary.',
  async call(args) {
    const query = String(args['query'] ?? '');
    if (!query) return { ok: false, output: 'Missing required argument: query' };
    return { ok: false, output: 'web_search: not yet implemented. Please integrate a search API.' };
  },
};
