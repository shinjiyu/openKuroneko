import fs from 'node:fs';
import path from 'node:path';
import type { LogEntry, LogLevel, Logger } from './index.js';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function logFilePath(tempDir: string): string {
  return path.join(tempDir, 'logs', `${today()}.jsonl`);
}

export function createLogger(agentId: string, tempDir: string): Logger {
  const logsDir = path.join(tempDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  function write(level: LogLevel, module: string, payload: { event: string; data?: unknown }): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      module,
      agentId,
      event: payload.event,
      data: payload.data,
    };
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(logFilePath(tempDir), line, 'utf8');
  }

  return {
    debug: (mod, p) => write('debug', mod, p),
    info:  (mod, p) => write('info',  mod, p),
    warn:  (mod, p) => write('warn',  mod, p),
    error: (mod, p) => write('error', mod, p),
  };
}
