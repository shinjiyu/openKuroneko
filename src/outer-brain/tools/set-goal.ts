/**
 * set_goal — 为内脑设置新目标，并在需要时自动启动内脑进程
 *
 * 写入内脑的 input 文件（覆盖语义），触发内脑 archiveForNewTask + 新 goal。
 * 如果 InnerBrainManager 已提供且内脑当前未运行，自动 launch。
 */

import fs from 'node:fs';
import type { ObTool } from './types.js';
import type { InnerBrainManager } from '../inner-brain-manager.js';

export function createSetGoalTool(
  innerTempDir: string,
  innerBrainMgr?: InnerBrainManager | undefined,
  onGoalSet?: (goal: string, originUser: string) => void,
): ObTool {
  const inputFile  = `${innerTempDir}/input`;
  const statusFile = `${innerTempDir}/status`;

  return {
    name: 'set_goal',
    description:
      '为内脑设置新目标。内脑会归档当前任务，从干净状态开始执行新目标。' +
      '如果内脑未运行，会自动启动。请确认用户明确要求开始新任务后再调用此工具。',
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

      const message = `[NEW_GOAL]\norigin_user: ${originUser}\n\n${goal}`;

      // 按需启动内脑（必须在 append 之前决定，避免 offset 竞争）
      const offsetFile = `${inputFile}.offset`;
      let launchNote = '';
      if (innerBrainMgr) {
        if (!innerBrainMgr.isRunning()) {
          // 内脑未运行：将 offset 对齐到当前文件末尾，再追加新目标。
          // 这样新启动的内脑实例只读到本次的 [NEW_GOAL]，不会重读历史内容。
          const currentSize = fs.existsSync(inputFile) ? fs.statSync(inputFile).size : 0;
          fs.writeFileSync(offsetFile, String(currentSize), 'utf8');
          fs.appendFileSync(inputFile, '\n' + message + '\n', 'utf8');
          innerBrainMgr.launch();
          launchNote = ' 内脑进程已自动启动。';
        } else {
          // 内脑已在运行：追加到文件末尾，内脑自行以当前 offset 读取
          fs.appendFileSync(inputFile, '\n' + message + '\n', 'utf8');
          launchNote = ' 内脑已在运行，新目标已写入队列。';
        }
      } else {
        // 无 InnerBrainManager：直接追加
        fs.appendFileSync(inputFile, '\n' + message + '\n', 'utf8');
      }

      // 更新 status 中的 goal_origin_user（快速读取用）
      try {
        const existing = fs.existsSync(statusFile)
          ? (JSON.parse(fs.readFileSync(statusFile, 'utf8')) as Record<string, unknown>)
          : {};
        existing['goal_origin_user'] = originUser;
        fs.writeFileSync(statusFile, JSON.stringify(existing, null, 2), 'utf8');
      } catch { /* 非关键 */ }

      onGoalSet?.(goal, originUser);

      return {
        ok: true,
        output: `新目标已发送给内脑，来源用户：${originUser}。${launchNote}`.trim(),
      };
    },
  };
}
