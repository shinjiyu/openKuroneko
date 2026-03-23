import path from 'node:path';

export const SELF_EVOLUTION_DIR = '.self-evolution';

export function evolutionDir(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), SELF_EVOLUTION_DIR);
}

export function statePath(repoRoot: string): string {
  return path.join(evolutionDir(repoRoot), 'state.json');
}

export function lockPath(repoRoot: string): string {
  return path.join(evolutionDir(repoRoot), 'lock');
}
