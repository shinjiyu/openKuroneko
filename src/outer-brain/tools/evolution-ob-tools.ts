/**
 * 外脑可调用的自演化工具 — 封装 EvolutionGate + Git worktree 流程（协议：doc/protocols/self-evolution.md）
 *
 * 仅作用于单一 Git 根目录（通常为 <obDir>/..），无 shell_exec（verify 在子进程中执行固定 shell 命令字符串）。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { Logger } from '../../logger/index.js';
import { EvolutionGate } from '../../evolution/gate.js';
import {
  branchDelete,
  mergeFeatureBranch,
  resolveMainBranch,
  worktreeRemove,
} from '../../evolution/git-ops.js';
import type { InnerBrainPool } from '../inner-brain-pool.js';
import type { ObTool } from './types.js';

const VERIFY_TIMEOUT_MS = 600_000;

function gate(repo: string): EvolutionGate {
  return new EvolutionGate(repo);
}

export function createEvolutionObTools(repoRoot: string, logger: Logger): ObTool[] {
  const root = path.resolve(repoRoot);
  const log = (event: string, data?: Record<string, unknown>) => {
    logger.info('outer-brain', { event, data: { ...data, repoRoot: root } });
  };

  const evolution_begin: ObTool = {
    name: 'evolution_begin',
    description:
      '在已绑定的 Git 仓库根目录开启自演化事务：记录当前 HEAD，可选 stash 脏工作区。' +
      '之后应让内脑或人工修改该仓库内代码，再依次 evolution_verify → evolution_commit 或 evolution_rollback。' +
      '会操作真实 git，请仅在用户明确要求「自演化/提交/回滚」时使用。',
    parameters: {
      allow_dirty: {
        type: 'string',
        description: '传 "true" 时工作区有未提交变更会自动 git stash（含未跟踪文件）',
        required: false,
      },
    },
    async call(args): Promise<{ ok: boolean; output: string }> {
      const allow = String(args['allow_dirty'] ?? '').toLowerCase() === 'true';
      log('evolution_begin.call', { allow_dirty: allow });
      const r = gate(root).begin({ allowDirty: allow });
      if (!r.ok) return { ok: false, output: r.error ?? 'begin 失败' };
      return {
        ok: true,
        output: `已开启事务 base_sha=${r.base_sha} stashed=${r.stashed === true}。下一步：改代码后 evolution_verify，再 evolution_commit -m 或 evolution_rollback。`,
      };
    },
  };

  const evolution_verify: ObTool = {
    name: 'evolution_verify',
    description:
      '在绑定仓库根执行验证命令（默认 npm run build）。不改变 Git 事务状态；失败则说明不应 commit。',
    parameters: {
      command: {
        type: 'string',
        description: 'Shell 命令，默认 npm run build',
        required: false,
      },
    },
    async call(args): Promise<{ ok: boolean; output: string }> {
      const cmd = args['command'] != null && String(args['command']).trim()
        ? String(args['command']).trim()
        : 'npm run build';
      log('evolution_verify.call', { command: cmd });
      const r = gate(root).verify({ command: cmd });
      if (!r.ok) {
        return {
          ok: false,
          output: [
            r.error ?? 'verify 失败',
            r.stdout ? `--- stdout ---\n${r.stdout}` : '',
            r.stderr ? `--- stderr ---\n${r.stderr}` : '',
          ].filter(Boolean).join('\n'),
        };
      }
      return { ok: true, output: `验证通过（${r.durationMs ?? 0} ms）。可 evolution_commit 或继续修改后再 verify。` };
    },
  };

  const evolution_commit: ObTool = {
    name: 'evolution_commit',
    description:
      '在绑定仓库执行 git add -A && git commit。必须先 evolution_begin 且 verify 通过后再调用。',
    parameters: {
      message: {
        type: 'string',
        description: 'Git 提交说明（必填）',
        required: true,
      },
    },
    async call(args): Promise<{ ok: boolean; output: string }> {
      const message = String(args['message'] ?? '').trim();
      if (!message) return { ok: false, output: 'message 不能为空' };
      log('evolution_commit.call', { preview: message.slice(0, 80) });
      const r = gate(root).commit(message);
      if (!r.ok) return { ok: false, output: r.error ?? 'commit 失败' };
      return { ok: true, output: `已提交 commit_sha=${r.commit_sha ?? ''}` };
    },
  };

  const evolution_rollback: ObTool = {
    name: 'evolution_rollback',
    description:
      '将绑定仓库 reset --hard 到 evolution_begin 时的 HEAD，并尝试 stash pop。放弃当前事务。',
    parameters: {},
    async call(): Promise<{ ok: boolean; output: string }> {
      log('evolution_rollback.call', {});
      const r = gate(root).rollback();
      if (!r.ok) return { ok: false, output: r.error ?? 'rollback 失败' };
      return { ok: true, output: '已回滚到 begin 时的快照。' };
    },
  };

  const evolution_status: ObTool = {
    name: 'evolution_status',
    description: '查看当前自演化状态（idle / changing、base_sha 等），不修改仓库。',
    parameters: {},
    async call(): Promise<{ ok: boolean; output: string }> {
      const s = gate(root).getState();
      return { ok: true, output: JSON.stringify(s, null, 2) };
    },
  };

  return [evolution_begin, evolution_verify, evolution_commit, evolution_rollback, evolution_status];
}

function assertWorktreeInstance(
  pool: InnerBrainPool,
  repoRoot: string,
  instanceId: string,
): { ok: true; rec: NonNullable<ReturnType<InnerBrainPool['get']>> } | { ok: false; output: string } {
  const rec = pool.get(instanceId);
  if (!rec) {
    return { ok: false, output: `找不到实例 ${instanceId}，请先 list_inner_brains。` };
  }
  if (!rec.gitEvolveBranch || !rec.gitRepoRoot) {
    return { ok: false, output: `实例 ${instanceId} 非 Git worktree 模式（无 evolve 分支记录）。` };
  }
  const root = path.resolve(repoRoot);
  if (path.resolve(rec.gitRepoRoot) !== root) {
    return { ok: false, output: '实例所属仓库与当前外脑绑定的 evolution 根不一致，拒绝操作。' };
  }
  if (rec.gitWorktreePath && path.resolve(rec.workDir) !== path.resolve(rec.gitWorktreePath)) {
    return { ok: false, output: '实例 worktree 路径记录异常。' };
  }
  return { ok: true, rec };
}

/**
 * 多实例 worktree 自演化：verify / merge / abort（须 InnerBrainPool 已配置 gitRepoRoot 且与 repoRoot 一致）
 */
export function createEvolutionWorktreeObTools(
  pool: InnerBrainPool,
  repoRoot: string,
  logger: Logger,
): ObTool[] {
  const root = path.resolve(repoRoot);
  const log = (event: string, data?: Record<string, unknown>) => {
    logger.info('outer-brain', { event, data: { ...data, repoRoot: root } });
  };

  const evolution_worktree_verify: ObTool = {
    name: 'evolution_worktree_verify',
    description:
      '在指定内脑实例的 Git worktree 目录执行验证命令（默认 npm run build）。' +
      'instance_id 来自 list_inner_brains。合并进主分支前应先 verify 通过。',
    parameters: {
      instance_id: {
        type:        'string',
        description: '内脑实例 ID',
        required:    true,
      },
      command: {
        type:        'string',
        description: 'Shell 命令，默认 npm run build',
        required:    false,
      },
    },
    async call(args): Promise<{ ok: boolean; output: string }> {
      const instanceId = String(args['instance_id'] ?? '').trim();
      if (!instanceId) return { ok: false, output: 'instance_id 不能为空' };
      const gate = assertWorktreeInstance(pool, root, instanceId);
      if (!gate.ok) return { ok: false, output: gate.output };

      const command = args['command'] != null && String(args['command']).trim()
        ? String(args['command']).trim()
        : 'npm run build';
      log('evolution_worktree_verify.call', { instanceId, command, cwd: gate.rec.workDir });

      const started = Date.now();
      const r = spawnSync(command, {
        cwd:     gate.rec.workDir,
        shell:   true,
        encoding: 'utf8',
        timeout: VERIFY_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        env:     process.env,
      });
      const durationMs = Date.now() - started;
      const stdout = r.stdout?.slice(0, 32_000) ?? '';
      const stderr = r.stderr?.slice(0, 32_000) ?? '';

      if (r.error) {
        logger.error('outer-brain', {
          event: 'evolution_worktree_verify.spawn_error',
          data: { instanceId, error: r.error.message, durationMs },
        });
        return { ok: false, output: [r.error.message, stdout, stderr].filter(Boolean).join('\n') };
      }
      const exitCode = r.status ?? -1;
      if (exitCode !== 0) {
        logger.warn('outer-brain', {
          event: 'evolution_worktree_verify.failed',
          data: { instanceId, exitCode, durationMs },
        });
        return {
          ok: false,
          output: [`命令退出码 ${exitCode}（${durationMs} ms）`, stdout, stderr].filter(Boolean).join('\n'),
        };
      }
      return { ok: true, output: `验证通过（${durationMs} ms）。可调用 evolution_worktree_merge 将 ${gate.rec.gitEvolveBranch} 并入主分支。` };
    },
  };

  const evolution_worktree_merge: ObTool = {
    name: 'evolution_worktree_merge',
    description:
      '在主仓库检出主分支并 merge 该实例的 evolve 分支；成功后可选移除 worktree 并删除已合并分支。' +
      '实例须已退出（先 stop_inner_brain）。冲突时需人工在仓库根解决。',
    parameters: {
      instance_id: {
        type:        'string',
        description: '内脑实例 ID',
        required:    true,
      },
      cleanup: {
        type:        'string',
        description: '传 "false" 时不删除 worktree/分支（仅 merge）',
        required:    false,
      },
    },
    async call(args): Promise<{ ok: boolean; output: string }> {
      const instanceId = String(args['instance_id'] ?? '').trim();
      if (!instanceId) return { ok: false, output: 'instance_id 不能为空' };
      const cleanup = String(args['cleanup'] ?? '').toLowerCase() !== 'false';

      const gate = assertWorktreeInstance(pool, root, instanceId);
      if (!gate.ok) return { ok: false, output: gate.output };
      const rec = gate.rec;

      if (rec.status === 'RUNNING') {
        return { ok: false, output: '实例仍在运行，请先 stop_inner_brain 再 merge。' };
      }

      const mainBranch = rec.gitMainBranch ?? resolveMainBranch(root);
      const branch     = rec.gitEvolveBranch!;
      log('evolution_worktree_merge.call', { instanceId, mainBranch, branch, cleanup });

      const m = mergeFeatureBranch(root, mainBranch, branch);
      if (!m.ok) {
        logger.error('outer-brain', {
          event: 'evolution_worktree_merge.failed',
          data: { instanceId, err: m.err },
        });
        return { ok: false, output: `merge 失败：${m.err}` };
      }

      const parts = [`已合并 ${branch} → ${mainBranch}。`];

      if (cleanup) {
        let rm = worktreeRemove(root, rec.workDir, false);
        if (!rm.ok) {
          rm = worktreeRemove(root, rec.workDir, true);
        }
        if (!rm.ok) {
          parts.push(`worktree 移除失败：${rm.err}（可稍后手动 git worktree remove）`);
        } else {
          parts.push('已移除 worktree 目录。');
        }

        const bd = branchDelete(root, branch, false);
        if (!bd.ok) {
          parts.push(`分支删除失败：${bd.err}（若已不存在可忽略）`);
        } else {
          parts.push(`已删除本地分支 ${branch}。`);
        }
      }

      logger.info('outer-brain', {
        event: 'evolution_worktree_merge.ok',
        data: { instanceId, mainBranch, branch, cleanup },
      });

      return { ok: true, output: parts.join(' ') };
    },
  };

  const evolution_worktree_abort: ObTool = {
    name: 'evolution_worktree_abort',
    description:
      '放弃该实例的 evolve 分支：force 移除 worktree 并强删分支（未合并变更会丢失）。实例须已退出。',
    parameters: {
      instance_id: {
        type:        'string',
        description: '内脑实例 ID',
        required:    true,
      },
    },
    async call(args): Promise<{ ok: boolean; output: string }> {
      const instanceId = String(args['instance_id'] ?? '').trim();
      if (!instanceId) return { ok: false, output: 'instance_id 不能为空' };

      const gate = assertWorktreeInstance(pool, root, instanceId);
      if (!gate.ok) return { ok: false, output: gate.output };
      const rec = gate.rec;

      if (rec.status === 'RUNNING') {
        return { ok: false, output: '实例仍在运行，请先 stop_inner_brain 再 abort。' };
      }

      const branch = rec.gitEvolveBranch!;
      log('evolution_worktree_abort.call', { instanceId, branch, workDir: rec.workDir });

      const rm = worktreeRemove(root, rec.workDir, true);
      if (!rm.ok) {
        logger.error('outer-brain', {
          event: 'evolution_worktree_abort.worktree_failed',
          data: { instanceId, err: rm.err },
        });
        return { ok: false, output: `worktree remove 失败：${rm.err}` };
      }

      const bd = branchDelete(root, branch, true);
      if (!bd.ok) {
        logger.warn('outer-brain', {
          event: 'evolution_worktree_abort.branch_failed',
          data: { instanceId, err: bd.err },
        });
        return { ok: true, output: `已移除 worktree；分支 ${branch} 删除失败（可能已删）：${bd.err}` };
      }

      logger.info('outer-brain', {
        event: 'evolution_worktree_abort.ok',
        data: { instanceId, branch },
      });

      return { ok: true, output: `已放弃：worktree 已移除，分支 ${branch} 已强删。` };
    },
  };

  return [evolution_worktree_verify, evolution_worktree_merge, evolution_worktree_abort];
}

/**
 * 解析自演化 Git 根目录。
 * - explicit === null → 不启用
 * - explicit 为非空 string → 使用该路径（须存在 .git）
 * - explicit === undefined → 使用 path.resolve(obDir, '..')（须存在 .git）
 */
export function resolveEvolutionRepoRoot(obDir: string, explicit: string | null | undefined): string | null {
  if (explicit === null) return null;
  const candidate =
    typeof explicit === 'string' && explicit.trim() !== ''
      ? path.resolve(explicit.trim())
      : path.resolve(obDir, '..');
  const gitMarker = path.join(candidate, '.git');
  if (!fs.existsSync(gitMarker)) return null;
  return candidate;
}
