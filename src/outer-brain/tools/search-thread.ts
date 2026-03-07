/**
 * search_thread — 搜索群聊或私信历史
 *
 * 群聊历史不注入上下文，仅在 LLM 需要时通过此工具查询。
 * 类比"让人去群里翻一下"。
 */

import type { ObTool } from './types.js';
import type { ThreadStore } from '../../threads/store.js';

export function createSearchThreadTool(threadStore: ThreadStore): ObTool {
  return {
    name: 'search_thread',
    description:
      '搜索指定对话线程的历史消息。用于查询群聊记录或回顾私信上下文。' +
      'thread_id 格式：<channel>:<type>:<id>，如 "feishu:group:G001"。',
    parameters: {
      thread_id: {
        type: 'string',
        description: '要搜索的 thread_id，必须从系统提示中的【已知对话频道】列表中选取',
        required: true,
      },
      query: {
        type: 'string',
        description: '关键词（空格分隔可多关键词）；留空则返回最近 N 条消息',
      },
      limit: {
        type: 'number',
        description: '返回条数上限（默认 10）',
      },
    },
    async call(args): Promise<{ ok: boolean; output: string }> {
      const threadId = String(args['thread_id'] ?? '');
      const query    = String(args['query'] ?? '').trim();
      const limit    = Math.min(Number(args['limit'] ?? 10), 30);

      if (!threadId) return { ok: false, output: 'thread_id 不能为空' };

      // query 为空时，返回最近 N 条消息
      if (!query) {
        const history = threadStore.getHistory(threadId);
        const recent  = history.slice(-limit);
        if (!recent.length) return { ok: true, output: `${threadId} 暂无历史记录。` };
        const lines = recent.map((h) => {
          const who  = h.role === 'user' ? (h.user_id ?? 'user') : 'agent';
          const time = new Date(h.ts).toLocaleString('zh-CN');
          return `[${time}] ${who}: ${h.content}`;
        });
        return { ok: true, output: `${threadId} 最近 ${recent.length} 条记录：\n\n${lines.join('\n')}` };
      }

      const results = threadStore.searchHistory(threadId, query, limit);
      if (!results.length) {
        return { ok: true, output: `在 ${threadId} 中未找到匹配"${query}"的消息。` };
      }

      const lines = results.map((h) => {
        const who  = h.role === 'user' ? (h.user_id ?? 'user') : 'agent';
        const time = new Date(h.ts).toLocaleString('zh-CN');
        return `[${time}] ${who}: ${h.content}`;
      });

      return {
        ok: true,
        output: `在 ${threadId} 中找到 ${results.length} 条匹配记录：\n\n${lines.join('\n')}`,
      };
    },
  };
}
