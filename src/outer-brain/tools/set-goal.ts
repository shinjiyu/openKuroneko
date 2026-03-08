/**
 * set_goal — 为内脑设置新目标，每次调用启动一个独立实例
 *
 * 每次调用都创建新的内脑实例（独立工作目录 + 独立临时目录），
 * 真正实现并行任务执行，同时避免跨任务工作目录污染。
 */

import type { ObTool } from './types.js';
import type { InnerBrainPool } from '../inner-brain-pool.js';

export function createSetGoalTool(
  pool: InnerBrainPool,
  onGoalSet?: (goal: string, originUser: string, instanceId: string) => void,
): ObTool {
  return {
    name: 'set_goal',
    description:
      '为内脑启动新任务实例。每次调用都会创建独立的内脑进程（独立工作目录），支持多任务并行。' +
      '请确认用户明确要求开始新任务后再调用。返回 instance_id，可用于后续操作（停止/发送指令）。',
    parameters: {
      goal: {
        type: 'string',
        description: '新目标的完整描述（支持多行 Markdown）',
        required: true,
      },
      origin_user: {
        type: 'string',
        description: '下达此目标的用户 user_id（用于 BLOCK 通知路由）',
        required: true,
      },
    },
    async call(args): Promise<{ ok: boolean; output: string }> {
      const goal       = String(args['goal'] ?? '');
      const originUser = String(args['origin_user'] ?? '');

      if (!goal) return { ok: false, output: 'goal 不能为空' };

      let instanceId: string;
      try {
        instanceId = pool.launch(goal, originUser);
      } catch (err) {
        return { ok: false, output: String(err instanceof Error ? err.message : err) };
      }

      onGoalSet?.(goal, originUser, instanceId);

      return {
        ok: true,
        output: `新内脑实例已启动，instance_id=${instanceId}，来源用户：${originUser}。可用 list_inner_brains 查看所有实例状态。`,
      };
    },
  };
}
