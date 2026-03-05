/**
 * M2 · Config & Soul Loader
 *
 * 职责：
 * - 加载 agent.config.json（临时目录内）
 * - 加载 soul.md（临时目录内，支持热载）
 * - 热载：监听 soul.md 变更，回调通知 Runner
 */

export interface AgentConfig {
  model?: string;
  loopMode?: 'fast' | 'interval' | 'once';
  intervalMs?: number;
  endpoints?: Array<{ id: string; inputPath?: string; outputPath?: string }>;
}

export interface SoulWatcher {
  getSoul(): string;
  stop(): void;
}

export { loadConfig, watchSoul } from './config.js';
