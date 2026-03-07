/**
 * send_directive — 向内脑发送即时指令（补充约束/要求）
 *
 * 写入 <innerTempDir>/directives（JSON Lines 追加）。
 * 内脑每轮 tick 检查并消费该文件。
 *
 * type:
 *   "constraint"  → 补充约束（写入 constraints.md）
 *   "requirement" → 补充任务要求（追加到当前上下文）
 *   "feedback"    → 用户反馈（仅记录，不修改大脑文件）
 */

import fs from 'node:fs';
import type { ObTool } from './types.js';

export function createSendDirectiveTool(innerTempDir: string): ObTool {
  const directivesFile = `${innerTempDir}/directives`;

  return {
    name: 'send_directive',
    description:
      '向内脑发送即时指令。type 可以是：\n' +
      '- "constraint": 补充约束（如"使用无痕模式"）\n' +
      '- "requirement": 补充任务要求（如"额外分析粉丝趋势"）\n' +
      '- "feedback": 用户反馈（如"做得好，继续"）',
    parameters: {
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

      const entry = JSON.stringify({
        ts:      new Date().toISOString(),
        type,
        content,
        from,
      });

      fs.appendFileSync(directivesFile, entry + '\n', 'utf8');
      return { ok: true, output: `指令已发送给内脑（type=${type}）` };
    },
  };
}
