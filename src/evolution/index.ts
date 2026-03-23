/**
 * 自演化模块 — 协议见 doc/protocols/self-evolution.md
 */

export { EvolutionGate, type EvolutionGateOptions } from './gate.js';
export {
  EVOLUTION_STATE_VERSION,
  type EvolutionBeginResult,
  type EvolutionCommitResult,
  type EvolutionSimpleResult,
  type EvolutionStateV1,
  type EvolutionStatus,
  type EvolutionVerifyResult,
} from './types.js';
export { SELF_EVOLUTION_DIR, evolutionDir, lockPath, statePath } from './paths.js';
export { readState, writeState, idleState } from './state-file.js';
export { tryAcquireLock, releaseLock } from './lock-file.js';
