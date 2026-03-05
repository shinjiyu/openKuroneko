import type { Mem0Client } from './index.js';

/**
 * Mem0 REST 客户端（占位实现，后续对接实际 Mem0 实例）
 * 协议文档：doc/protocols/memory-interface.md（待建）
 */
export function createMem0Client(baseUrl?: string): Mem0Client {
  const url = baseUrl ?? process.env['MEM0_BASE_URL'] ?? 'http://localhost:8000';

  return {
    async add(content, agentId) {
      await fetch(`${url}/v1/memories/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content }], user_id: agentId }),
      });
    },
    async search(query, agentId, limit = 5) {
      const res = await fetch(`${url}/v1/memories/search/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, user_id: agentId, limit }),
      });
      const data = await res.json() as Array<{ memory: string }>;
      return data.map(d => d.memory);
    },
  };
}
