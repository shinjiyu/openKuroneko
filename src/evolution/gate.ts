/**
 * EvolutionGate — 自演化事务（协议：doc/protocols/self-evolution.md）
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

import type { Logger } from '../logger/index.js';
import { createLogger } from '../logger/index.js';
import {
  addAll,
  commit as gitCommit,
  getHeadSha,
  isGitRepo,
  isWorkingTreeClean,
  resetHard,
  stashPop,
  stashPush,
} from './git-ops.js';
import { releaseLock, tryAcquireLock } from './lock-file.js';
import { evolutionDir } from './paths.js';
import { idleState, readState, writeState } from './state-file.js';
import type {
  EvolutionBeginResult,
  EvolutionCommitResult,
  EvolutionSimpleResult,
  EvolutionStateV1,
  EvolutionVerifyResult,
} from './types.js';

const MODULE = 'evolution';

export interface EvolutionGateOptions {
  /** 默认 verify 超时（毫秒） */
  verifyTimeoutMs?: number;
}

export class EvolutionGate {
  private readonly root: string;
  private readonly logger: Logger;
  private readonly verifyTimeoutMs: number;

  constructor(repoRoot: string, options?: EvolutionGateOptions) {
    this.root = path.resolve(repoRoot);
    this.verifyTimeoutMs = options?.verifyTimeoutMs ?? 600_000;
    const evoDir = evolutionDir(this.root);
    this.logger = createLogger('evolution', evoDir);
  }

  /** 当前状态（只读） */
  getState(): EvolutionStateV1 {
    return readState(this.root);
  }

  begin(opts?: { allowDirty?: boolean }): EvolutionBeginResult {
    const allowDirty = opts?.allowDirty === true;
    const state = readState(this.root);

    if (state.status === 'changing') {
      return { ok: false, error: '已有未结束的演化事务，请先执行 rollback 或 commit' };
    }

    const lock = tryAcquireLock(this.root);
    if (!lock.ok) {
      return { ok: false, error: lock.error };
    }

    if (!isGitRepo(this.root)) {
      releaseLock(this.root);
      this.logger.error(MODULE, { event: 'begin.not_git', data: { root: this.root } });
      return { ok: false, error: '不是 Git 仓库（git rev-parse 失败）' };
    }

    const head = getHeadSha(this.root);
    if (!head.ok) {
      releaseLock(this.root);
      this.logger.error(MODULE, { event: 'begin.no_head', data: { err: head.err } });
      return { ok: false, error: head.err };
    }

    const clean = isWorkingTreeClean(this.root);
    let stashed = false;
    if (!clean) {
      if (!allowDirty) {
        releaseLock(this.root);
        this.logger.warn(MODULE, { event: 'begin.dirty', data: { root: this.root } });
        return {
          ok: false,
          error: '工作区有未提交变更。请先提交或 stash，或对 begin 使用 allow-dirty',
        };
      }
      const msg = `openkuroneko-evolution-begin-${new Date().toISOString()}`;
      const sp = stashPush(this.root, msg);
      if (!sp.ok) {
        releaseLock(this.root);
        this.logger.error(MODULE, { event: 'begin.stash_failed', data: { err: sp.err } });
        return { ok: false, error: `stash 失败：${sp.err}` };
      }
      stashed = true;
    }

    const next: EvolutionStateV1 = {
      version: 1,
      status: 'changing',
      base_sha: head.sha,
      stashed,
      started_at: new Date().toISOString(),
    };
    writeState(this.root, next);
    releaseLock(this.root);
    this.logger.info(MODULE, {
      event: 'begin.ok',
      data: { base_sha: head.sha, stashed },
    });
    return { ok: true, base_sha: head.sha, stashed };
  }

  verify(opts?: { command?: string }): EvolutionVerifyResult {
    const command = (opts?.command ?? 'npm run build').trim();
    const started = Date.now();

    this.logger.info(MODULE, { event: 'verify.start', data: { command } });

    const r = spawnSync(command, {
      cwd: this.root,
      shell: true,
      encoding: 'utf8',
      timeout: this.verifyTimeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: process.env,
    });

    const durationMs = Date.now() - started;
    const exitCode = r.status ?? -1;
    const stdout = r.stdout?.slice(0, 32_000) ?? '';
    const stderr = r.stderr?.slice(0, 32_000) ?? '';

    if (r.error) {
      const msg = r.error.message;
      this.logger.error(MODULE, {
        event: 'verify.spawn_error',
        data: { command, error: msg, durationMs },
      });
      return {
        ok: false,
        exitCode: -1,
        durationMs,
        error: msg,
        stdout,
        stderr,
      };
    }

    if (exitCode !== 0) {
      this.logger.warn(MODULE, {
        event: 'verify.failed',
        data: { command, exitCode, durationMs },
      });
      return {
        ok: false,
        exitCode,
        durationMs,
        error: `命令退出码 ${exitCode}`,
        stdout,
        stderr,
      };
    }

    this.logger.info(MODULE, {
      event: 'verify.ok',
      data: { command, durationMs },
    });
    return { ok: true, exitCode: 0, durationMs, stdout, stderr };
  }

  commit(message: string): EvolutionCommitResult {
    const msg = message.trim();
    if (!msg) {
      return { ok: false, error: '提交说明不能为空' };
    }

    const state = readState(this.root);
    if (state.status !== 'changing' || !state.base_sha) {
      return { ok: false, error: '当前无进行中的演化事务（需先 begin）' };
    }

    const lock = tryAcquireLock(this.root);
    if (!lock.ok) {
      return { ok: false, error: lock.error };
    }

    const a = addAll(this.root);
    if (!a.ok) {
      releaseLock(this.root);
      this.logger.error(MODULE, { event: 'commit.add_failed', data: { err: a.err } });
      return { ok: false, error: a.err };
    }

    const c = gitCommit(this.root, msg);
    if (!c.ok) {
      releaseLock(this.root);
      this.logger.error(MODULE, { event: 'commit.git_failed', data: { err: c.err } });
      return { ok: false, error: c.err };
    }

    writeState(this.root, idleState());
    releaseLock(this.root);
    this.logger.info(MODULE, {
      event: 'commit.ok',
      data: { commit_sha: c.sha },
    });
    return { ok: true, commit_sha: c.sha };
  }

  rollback(): EvolutionSimpleResult {
    const state = readState(this.root);
    if (state.status !== 'changing' || !state.base_sha) {
      return { ok: false, error: '当前无进行中的演化事务，无需 rollback' };
    }

    const lock = tryAcquireLock(this.root);
    if (!lock.ok) {
      return { ok: false, error: lock.error };
    }

    const rh = resetHard(this.root, state.base_sha);
    if (!rh.ok) {
      releaseLock(this.root);
      this.logger.error(MODULE, { event: 'rollback.reset_failed', data: { err: rh.err } });
      return { ok: false, error: rh.err };
    }

    if (state.stashed) {
      const pop = stashPop(this.root);
      if (!pop.ok) {
        this.logger.warn(MODULE, {
          event: 'rollback.stash_pop_failed',
          data: { err: pop.err },
        });
      }
    }

    writeState(this.root, idleState());
    releaseLock(this.root);
    this.logger.info(MODULE, { event: 'rollback.ok', data: { base_sha: state.base_sha } });
    return { ok: true };
  }
}
