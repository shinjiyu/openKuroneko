/**
 * list_inner_brains — 列出所有内脑实例
 *
 * 返回所有实例（运行中 + 已退出）的概要信息，包含目标摘要、当前模式、里程碑进度。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ObTool } from './types.js';
import type { InnerBrainPool } from '../inner-brain-pool.js';

export function createListInnerBrainsTool(pool: InnerBrainPool): ObTool {
  return {
    name: 'list_inner_brains',
    description:
      '列出所有内脑实例（运行中和已完成的）。' +
      '显示每个实例的 ID、状态、目标摘要、当前里程碑、BLOCK 状态。',
    parameters: {},
    async call(): Promise<{ ok: boolean; output: string }> {
      const all = pool.list();
      if (!all.length) {
        return { ok: true, output: '当前没有内脑实例（使用 set_goal 启动新任务）。' };
      }

      const result = all.map((r) => {
        const statusFile = path.join(r.tempDir, 'status');
        let runtimeStatus: Record<string, unknown> | null = null;
        if (fs.existsSync(statusFile)) {
          try {
            runtimeStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8')) as Record<string, unknown>;
          } catch { /* ignore */ }
        }

        // 读取里程碑进度
        const milestonesFile = path.join(r.workDir, '.brain', 'milestones.md');
        let milestones: string[] = [];
        if (fs.existsSync(milestonesFile)) {
          milestones = fs.readFileSync(milestonesFile, 'utf8')
            .split('\n')
            .filter((l) => l.trim().startsWith('[M'));
        }

        return {
          id:          r.id,
          poolStatus:  r.status,
          originUser:  r.originUser,
          goal:        r.goal.slice(0, 100) + (r.goal.length > 100 ? '…' : ''),
          startedAt:   r.startedAt.toISOString(),
          exitedAt:    r.exitedAt?.toISOString() ?? null,
          exitCode:    r.exitCode,
          mode:        runtimeStatus?.['mode'] ?? null,
          milestone:   runtimeStatus?.['milestone'] ?? null,
          blocked:     runtimeStatus?.['blocked'] ?? null,
          blockReason: runtimeStatus?.['block_reason'] ?? null,
          milestones,
          ...(r.gitEvolveBranch
            ? {
                git_worktree:    true,
                work_dir:        r.workDir,
                git_evolve_branch: r.gitEvolveBranch,
                git_main_branch:   r.gitMainBranch ?? null,
              }
            : { git_worktree: false }),
        };
      });

      return { ok: true, output: JSON.stringify(result, null, 2) };
    },
  };
}
