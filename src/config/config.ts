import chokidar from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentConfig, SoulWatcher } from './index.js';

export function loadConfig(tempDir: string): AgentConfig {
  const configPath = path.join(tempDir, 'agent.config.json');
  if (!fs.existsSync(configPath)) return {};
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw) as AgentConfig;
}

export function watchSoul(tempDir: string, onChange?: (soul: string) => void): SoulWatcher {
  const soulPath = path.join(tempDir, 'soul.md');
  let currentSoul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf8') : '';

  const watcher = chokidar.watch(soulPath, { ignoreInitial: true });
  watcher.on('change', () => {
    currentSoul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf8') : '';
    onChange?.(currentSoul);
  });

  return {
    getSoul: () => currentSoul,
    stop: () => { watcher.close(); },
  };
}
