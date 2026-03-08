/**
 * stop_inner_brain — 停止内脑实例
 *
 * 支持按 instance_id 停止指定实例，或停止所有运行中的实例。
 */

import type { ObTool } from './types.js';
import type { InnerBrainPool } from '../inner-brain-pool.js';

export function createStopInnerBrainTool(pool: InnerBrainPool): ObTool {
  return {
    name: 'stop_inner_brain',
    description:
      '停止内脑进程。可以停止指定实例（传 instance_id）或所有实例（不传）。' +
      '适用于：内脑卡住需要强制重启、当前任务需要终止。停止后可再用 set_goal 启动新实例。',
    parameters: {
      instance_id: {
        type: 'string',
        description: '要停止的实例 ID（由 set_goal 或 list_inner_brains 返回）。不填则停止所有运行中的实例。',
        required: false,
      },
    },
    async call(args): Promise<{ ok: boolean; output: string }> {
      const instanceId = args['instance_id'] ? String(args['instance_id']) : undefined;

      if (instanceId) {
        const record = pool.get(instanceId);
        if (!record) {
          return { ok: false, output: `找不到实例 ${instanceId}。` };
        }
        if (record.status !== 'RUNNING') {
          return { ok: true, output: `实例 ${instanceId} 已不在运行中（状态：${record.status}）。` };
        }
        await pool.stop(instanceId);
        return { ok: true, output: `实例 ${instanceId} 已停止。` };
      }

      // 停止所有
      const running = pool.runningInstances();
      if (!running.length) {
        return { ok: true, output: '当前没有运行中的内脑实例。' };
      }
      await pool.stopAll();
      return { ok: true, output: `已停止 ${running.length} 个实例：${running.map(r => r.id).join(', ')}。` };
    },
  };
}
