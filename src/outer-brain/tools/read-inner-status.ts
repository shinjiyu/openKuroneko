/**
 * read_inner_status — 读取内脑实例状态快照
 *
 * 读取指定实例（或所有运行实例）的 <tempDir>/status 文件。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ObTool } from './types.js';
import type { InnerBrainPool } from '../inner-brain-pool.js';

export function createReadInnerStatusTool(pool: InnerBrainPool): ObTool {
  return {
    name: 'read_inner_status',
    description:
      '读取内脑实例当前状态（模式、正在执行的里程碑、是否 BLOCK）。' +
      '不填 instance_id 则返回所有运行中实例的状态汇总。',
    parameters: {
      instance_id: {
        type: 'string',
        description: '实例 ID（可选，不填则返回所有运行实例状态）',
        required: false,
      },
    },
    async call(args): Promise<{ ok: boolean; output: string }> {
      const instanceId = args['instance_id'] ? String(args['instance_id']) : undefined;

      if (instanceId) {
        const record = pool.get(instanceId);
        if (!record) return { ok: false, output: `找不到实例 ${instanceId}。` };
        const status = readStatus(record.tempDir);
        return {
          ok: true,
          output: JSON.stringify({ instanceId, workDir: record.workDir, ...status }, null, 2),
        };
      }

      // 返回所有实例摘要
      const all = pool.list();
      if (!all.length) return { ok: true, output: '当前没有内脑实例。' };

      const summary = all.map((r) => {
        const status = readStatus(r.tempDir);
        const entry: Record<string, unknown> = {
          id:          r.id,
          status:      r.status,
          originUser:  r.originUser,
          goal:        r.goal.slice(0, 80) + (r.goal.length > 80 ? '…' : ''),
          startedAt:   r.startedAt.toISOString(),
          exitedAt:    r.exitedAt?.toISOString() ?? null,
          currentMode: status?.mode ?? null,
          milestone:   status?.milestone ?? null,
          blocked:     status?.blocked ?? null,
        };
        // 循环里程碑 / 睡眠状态额外信息
        if (status?.mode === 'SLEEPING') {
          entry['sleeping_until'] = status['sleeping_until'] ?? null;
          entry['cycle_count']    = status['cycle_count'] ?? 0;
        }
        return entry;
      });

      return { ok: true, output: JSON.stringify(summary, null, 2) };
    },
  };
}

function readStatus(tempDir: string): Record<string, unknown> | null {
  const statusFile = path.join(tempDir, 'status');
  if (!fs.existsSync(statusFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(statusFile, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}
