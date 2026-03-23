/**
 * 自演化状态机类型 — 与 doc/protocols/self-evolution.md 对齐
 */

export const EVOLUTION_STATE_VERSION = 1 as const;

export type EvolutionStatus = 'idle' | 'changing';

export interface EvolutionStateV1 {
  version: typeof EVOLUTION_STATE_VERSION;
  status: EvolutionStatus;
  /** begin 时的 HEAD；idle 时为 null */
  base_sha: string | null;
  /** begin 时是否执行了 git stash push -u */
  stashed: boolean;
  started_at: string | null;
}

export interface EvolutionBeginResult {
  ok: boolean;
  base_sha?: string;
  stashed?: boolean;
  error?: string;
}

export interface EvolutionSimpleResult {
  ok: boolean;
  error?: string;
  stdout?: string;
  stderr?: string;
}

export interface EvolutionVerifyResult extends EvolutionSimpleResult {
  exitCode?: number;
  durationMs?: number;
}

export interface EvolutionCommitResult extends EvolutionSimpleResult {
  commit_sha?: string;
}
