/**
 * send_directive — 向内脑实例发送即时指令（补充约束/要求）
 *
 * 写入 <instanceTempDir>/directives（JSON Lines 追加）。
 * 内脑每轮 tick 检查并消费该文件。
 *
 * type:
 *   "constraint"  → 补充约束（写入 constraints.md）
 *   "requirement" → 补充任务要求（追加到当前上下文）
 *   "feedback"    → 用户反馈（仅记录，不修改大脑文件）
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ObTool } from './types.js';
import type { InnerBrainPool } from '../inner-brain-pool.js';

export function createSendDirectiveTool(pool: InnerBrainPool): ObTool {
  return {
    name: 'send_directive',
    description:
      '向指定内脑实例发送即时指令。type 可以是：\n' +
      '- "constraint": 补充约束（如"使用无痕模式"）\n' +
      '- "requirement": 补充任务要求（如"额外分析粉丝趋势"）\n' +
      '- "feedback": 用户反馈（如"做得好，继续"）\n' +
      '如果只有一个运行中的实例，instance_id 可以省略。',
    parameters: {
      instance_id: {
        type: 'string',
        description: '目标实例 ID。有多个运行实例时必填。',
        required: false,
      },
      type: {
        type: 'string',
        description: '"constraint" | "requirement" | "feedback"',
        required: true,
      },
      content: {
        type: 'string',
        description: '指令内容',
        required: true,
      },
      from: {
        type: 'string',
        description: '来自哪个用户（user_id）',
        required: true,
      },
    },
    async call(args): Promise<{ ok: boolean; output: string }> {
      const type    = String(args['type'] ?? 'feedback');
      const content = String(args['content'] ?? '');
      const from    = String(args['from'] ?? 'unknown');

      if (!content) return { ok: false, output: 'content 不能为空' };

      // 解析目标实例
      const instanceId = args['instance_id'] ? String(args['instance_id']) : undefined;
      let targetTempDir: string;

      if (instanceId) {
        const record = pool.get(instanceId);
        if (!record) return { ok: false, output: `找不到实例 ${instanceId}。` };
        if (record.status !== 'RUNNING') return { ok: false, output: `实例 ${instanceId} 已停止。` };
        targetTempDir = record.tempDir;
      } else {
        const running = pool.runningInstances();
        if (!running.length) return { ok: false, output: '没有运行中的内脑实例。' };
        if (running.length > 1) {
          return {
            ok: false,
            output: `有多个运行中的实例（${running.map(r => r.id).join(', ')}），请指定 instance_id。`,
          };
        }
        targetTempDir = running[0]!.tempDir;
      }

      const directivesFile = path.join(targetTempDir, 'directives');
      const entry = JSON.stringify({ ts: new Date().toISOString(), type, content, from });
      fs.appendFileSync(directivesFile, entry + '\n', 'utf8');

      return { ok: true, output: `指令已发送（type=${type}）` };
    },
  };
}
