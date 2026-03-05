/**
 * M9 · R-CCAM Runner
 *
 * 执行单次 SCL/ReCAP 循环：
 *   R  — Retrieval（读 input + 近期记忆 + Mem0 检索）
 *   C  — Cognition（ReCAP 目标分解 → 推理）
 *   A  — Action（调用工具）
 *   M  — Memory（写 Daily Log + Mem0）
 */

import type { LLMAdapter } from '../adapter/index.js';
import type { IORegistry } from '../io/index.js';
import type { ToolRegistry } from '../tools/index.js';
import type { MemoryLayer2 } from '../memory/index.js';
import type { Mem0Client } from '../mem0/index.js';
import type { Logger } from '../logger/index.js';

export interface RunnerContext {
  agentId: string;
  soul: string;
  workDir: string;
  tempDir: string;
}

export interface RunnerDeps {
  llm: LLMAdapter;
  ioRegistry: IORegistry;
  toolRegistry: ToolRegistry;
  memory: MemoryLayer2;
  mem0: Mem0Client;
  logger: Logger;
}

export { createRunner } from './runner.js';
export type { RunResult, Runner } from './runner.js';
