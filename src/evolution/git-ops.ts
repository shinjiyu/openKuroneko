/**
 * Git 子进程封装 — 无 shell 注入（参数数组）
 */

import { execFileSync } from 'node:child_process';

const MAX_BUFFER = 64 * 1024 * 1024;

export function gitExec(cwd: string, args: string[]): { ok: true; out: string } | { ok: false; err: string } {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, out: typeof out === 'string' ? out.trimEnd() : '' };
  } catch (e: unknown) {
    const x = e as { stderr?: Buffer | string; message?: string };
    const err =
      typeof x.stderr === 'string'
        ? x.stderr
        : Buffer.isBuffer(x.stderr)
          ? x.stderr.toString('utf8')
          : x.message ?? String(e);
    return { ok: false, err: err.trim() || String(e) };
  }
}

export function isGitRepo(cwd: string): boolean {
  const r = gitExec(cwd, ['rev-parse', '--git-dir']);
  return r.ok && r.out.length > 0;
}

export function getHeadSha(cwd: string): { ok: true; sha: string } | { ok: false; err: string } {
  const r = gitExec(cwd, ['rev-parse', 'HEAD']);
  if (!r.ok) return { ok: false, err: r.err };
  const sha = r.out.split('\n')[0]?.trim();
  if (!sha) return { ok: false, err: 'empty HEAD' };
  return { ok: true, sha };
}

export function isWorkingTreeClean(cwd: string): boolean {
  const r = gitExec(cwd, ['status', '--porcelain']);
  if (!r.ok) return false;
  return r.out.trim().length === 0;
}

export function stashPush(cwd: string, message: string): { ok: true } | { ok: false; err: string } {
  const r = gitExec(cwd, ['stash', 'push', '-u', '-m', message]);
  return r.ok ? { ok: true } : { ok: false, err: r.err };
}

export function resetHard(cwd: string, sha: string): { ok: true } | { ok: false; err: string } {
  const r = gitExec(cwd, ['reset', '--hard', sha]);
  return r.ok ? { ok: true } : { ok: false, err: r.err };
}

export function stashPop(cwd: string): { ok: true } | { ok: false; err: string } {
  const r = gitExec(cwd, ['stash', 'pop']);
  return r.ok ? { ok: true } : { ok: false, err: r.err };
}

export function addAll(cwd: string): { ok: true } | { ok: false; err: string } {
  const r = gitExec(cwd, ['add', '-A']);
  return r.ok ? { ok: true } : { ok: false, err: r.err };
}

export function commit(cwd: string, message: string): { ok: true; sha: string } | { ok: false; err: string } {
  const r = gitExec(cwd, ['commit', '-m', message]);
  if (!r.ok) return { ok: false, err: r.err };
  const h = gitExec(cwd, ['rev-parse', 'HEAD']);
  if (!h.ok) return { ok: false, err: h.err };
  const sha = h.out.split('\n')[0]?.trim() ?? '';
  if (!sha) return { ok: false, err: 'commit 后无法解析 HEAD' };
  return { ok: true, sha };
}

/** `git worktree add -b <branch> <path> <start>` — 在 repoRoot 主仓库注册新 worktree */
export function worktreeAdd(
  repoRoot: string,
  absWorktreePath: string,
  newBranch: string,
  startPoint: string,
): { ok: true } | { ok: false; err: string } {
  const r = gitExec(repoRoot, ['worktree', 'add', '-b', newBranch, absWorktreePath, startPoint]);
  return r.ok ? { ok: true } : { ok: false, err: r.err };
}

/** `git worktree remove [--force] <path>` — path 一般为绝对路径 */
export function worktreeRemove(
  repoRoot: string,
  absWorktreePath: string,
  force: boolean,
): { ok: true } | { ok: false; err: string } {
  const args = ['worktree', 'remove', ...(force ? ['--force'] : []), absWorktreePath];
  const r = gitExec(repoRoot, args);
  return r.ok ? { ok: true } : { ok: false, err: r.err };
}

export function branchExists(repoRoot: string, branch: string): boolean {
  const r = gitExec(repoRoot, ['rev-parse', '--verify', branch]);
  return r.ok;
}

/** 解析主集成分支：origin/HEAD → main / master 回退 */
export function resolveMainBranch(repoRoot: string): string {
  const sym = gitExec(repoRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
  if (sym.ok) {
    const m = sym.out.match(/refs\/remotes\/origin\/(.+)/);
    const b = m?.[1]?.trim();
    if (b) return b;
  }
  for (const b of ['main', 'master']) {
    if (branchExists(repoRoot, b)) return b;
  }
  return 'main';
}

/** worktree add 的起点：优先本地分支，否则 origin/<mainBranch> */
export function resolveWorktreeStartPoint(repoRoot: string, mainBranch: string): string {
  if (branchExists(repoRoot, mainBranch)) return mainBranch;
  const remote = `origin/${mainBranch}`;
  if (branchExists(repoRoot, remote)) return remote;
  return mainBranch;
}

/** 在主工作树 checkout mainBranch 后 merge featureBranch */
export function mergeFeatureBranch(
  repoRoot: string,
  mainBranch: string,
  featureBranch: string,
): { ok: true } | { ok: false; err: string } {
  let r = gitExec(repoRoot, ['checkout', mainBranch]);
  if (!r.ok) return { ok: false, err: `checkout ${mainBranch}: ${r.err}` };
  r = gitExec(repoRoot, ['merge', '--no-edit', featureBranch]);
  return r.ok ? { ok: true } : { ok: false, err: r.err };
}

export function branchDelete(repoRoot: string, branch: string, force: boolean): { ok: true } | { ok: false; err: string } {
  const flag = force ? '-D' : '-d';
  const r = gitExec(repoRoot, ['branch', flag, branch]);
  return r.ok ? { ok: true } : { ok: false, err: r.err };
}
