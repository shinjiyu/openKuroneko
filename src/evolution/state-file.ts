import fs from 'node:fs';
import path from 'node:path';

import { EVOLUTION_STATE_VERSION, type EvolutionStateV1 } from './types.js';
import { statePath } from './paths.js';

const IDLE: EvolutionStateV1 = {
  version: EVOLUTION_STATE_VERSION,
  status: 'idle',
  base_sha: null,
  stashed: false,
  started_at: null,
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

export function readState(repoRoot: string): EvolutionStateV1 {
  const p = statePath(repoRoot);
  if (!fs.existsSync(p)) return { ...IDLE };
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const j: unknown = JSON.parse(raw);
    if (!isRecord(j)) return { ...IDLE };
    if (j['version'] !== EVOLUTION_STATE_VERSION) return { ...IDLE };
    const status = j['status'];
    if (status !== 'idle' && status !== 'changing') return { ...IDLE };
    const base = j['base_sha'];
    const stashed = j['stashed'];
    const started = j['started_at'];
    return {
      version: EVOLUTION_STATE_VERSION,
      status,
      base_sha: typeof base === 'string' ? base : null,
      stashed: stashed === true,
      started_at: typeof started === 'string' ? started : null,
    };
  } catch {
    return { ...IDLE };
  }
}

export function writeState(repoRoot: string, s: EvolutionStateV1): void {
  const p = statePath(repoRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2), 'utf8');
}

export function idleState(): EvolutionStateV1 {
  return { ...IDLE };
}
