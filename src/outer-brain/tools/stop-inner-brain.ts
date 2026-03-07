/**
 * stop_inner_brain — 停止当前内脑进程
 *
 * 发送 SIGTERM 给内脑，等待其退出。
 * 停止后可通过 set_goal 重新启动并赋予新目标。
 */

import type { ObTool } from './types.js';
import type { InnerBrainManager } from '../inner-brain-manager.js';

export function createStopInnerBrainTool(
  innerBrainMgr: InnerBrainManager,
): ObTool {
  return {
    name: 'stop_inner_brain',
    description:
      '停止当前正在运行的内脑进程。适用于：内脑卡住需要强制重启、当前任务需要终止、' +
      '希望以全新状态重新派发任务。停止后请用 set_goal 重新派发目标（会自动重启内脑）。',
    parameters: {},
    async call(): Promise<{ ok: boolean; output: string }> {
      if (!innerBrainMgr.isRunning()) {
        return { ok: true, output: '内脑当前未在运行，无需停止。' };
      }

      await innerBrainMgr.stop(8_000);
      return { ok: true, output: '内脑已停止。可以用 set_goal 重新派发新目标，内脑会自动启动。' };
    },
  };
}
