/**
 * M11 · Logger — 独立结构化日志模块
 *
 * 所有模块通过本模块写日志，禁止直接 console.log。
 * 格式：JSON Lines，落 <tempDir>/logs/YYYY-MM-DD.jsonl
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;       // ISO 8601
  level: LogLevel;
  module: string;
  agentId: string;
  event: string;
  data?: unknown;
}

export interface Logger {
  debug(module: string, payload: Omit<LogEntry, 'ts' | 'level' | 'module' | 'agentId'>): void;
  info(module: string, payload: Omit<LogEntry, 'ts' | 'level' | 'module' | 'agentId'>): void;
  warn(module: string, payload: Omit<LogEntry, 'ts' | 'level' | 'module' | 'agentId'>): void;
  error(module: string, payload: Omit<LogEntry, 'ts' | 'level' | 'module' | 'agentId'>): void;
}

export { createLogger } from './logger.js';
export { pruneOldLogs } from './logger.js';
