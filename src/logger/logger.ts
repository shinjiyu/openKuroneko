import fs from 'node:fs';
import path from 'node:path';
import type { LogEntry, LogLevel, Logger } from './index.js';

const DEFAULT_RETAIN_DAYS = 7;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function logFilePath(logsDir: string): string {
  return path.join(logsDir, `${today()}.jsonl`);
}

/**
 * 删除 logsDir 下超过 retainDays 天的 .jsonl 文件
 * 文件名格式：YYYY-MM-DD.jsonl
 */
export function pruneOldLogs(logsDir: string, retainDays: number): void {
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(logsDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const dateStr = entry.name.slice(0, 10); // YYYY-MM-DD
    const ts = Date.parse(dateStr);
    if (!isNaN(ts) && ts < cutoff) {
      try {
        fs.rmSync(path.join(logsDir, entry.name), { force: true });
      } catch { /* ignore */ }
    }
  }
}

export function createLogger(
  agentId: string,
  tempDir: string,
  options?: { retainDays?: number }
): Logger {
  const retainDays = options?.retainDays ?? DEFAULT_RETAIN_DAYS;
  const logsDir = path.join(tempDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  // Prune old logs once on startup
  pruneOldLogs(logsDir, retainDays);

  // Re-prune at midnight (schedule once per logger instance)
  let lastPruneDate = today();
  function maybePrune(): void {
    const d = today();
    if (d !== lastPruneDate) {
      lastPruneDate = d;
      pruneOldLogs(logsDir, retainDays);
    }
  }

  function write(level: LogLevel, module: string, payload: { event: string; data?: unknown }): void {
    maybePrune();
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      module,
      agentId,
      event: payload.event,
      data: payload.data,
    };
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(logFilePath(logsDir), line, 'utf8');
  }

  return {
    debug: (mod, p) => write('debug', mod, p),
    info:  (mod, p) => write('info',  mod, p),
    warn:  (mod, p) => write('warn',  mod, p),
    error: (mod, p) => write('error', mod, p),
  };
}
