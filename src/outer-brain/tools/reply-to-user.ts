/**
 * reply_to_user — 向指定 thread 发送消息
 *
 * 外脑 LLM 通过此工具向用户回复。
 * ChannelRegistry 负责路由到正确的频道适配器。
 */

import type { ObTool } from './types.js';
import type { ChannelRegistry } from '../../channels/registry.js';

export function createReplyToUserTool(channelRegistry: ChannelRegistry): ObTool {
  return {
    name: 'reply_to_user',
    description:
      '向指定对话线程发送回复消息。thread_id 格式：<channel>:<type>:<id>，' +
      '如 "feishu:dm:alice" 或 "feishu:group:G001"。',
    parameters: {
      thread_id: {
        type: 'string',
        description: '目标 thread_id',
        required: true,
      },
      content: {
        type: 'string',
        description: '回复的文本内容',
        required: true,
      },
      reply_to_msg_id: {
        type: 'string',
        description: '可选：回复特定消息 ID（支持的平台会显示引用）',
      },
    },
    async call(args): Promise<{ ok: boolean; output: string }> {
      const threadId  = String(args['thread_id'] ?? '');
      const content   = String(args['content'] ?? '');
      const replyTo   = args['reply_to_msg_id'] ? String(args['reply_to_msg_id']) : undefined;

      if (!threadId) return { ok: false, output: 'thread_id 不能为空' };
      if (!content)  return { ok: false, output: 'content 不能为空' };

      try {
        await channelRegistry.send({ thread_id: threadId, content, reply_to: replyTo });
        return { ok: true, output: `消息已发送到 ${threadId}` };
      } catch (e) {
        return { ok: false, output: `发送失败：${String(e)}` };
      }
    },
  };
}
