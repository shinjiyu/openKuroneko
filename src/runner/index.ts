/**
 * M9 · R-CCAM Runner
 *
 * 执行单次 SCL/ReCAP 循环：
 *   R  — Retrieval（读 input + 近期记忆 + Mem0 检索）
 *   C  — Cognition（ReCAP 目标分解 → 推理）
 *   A  — Action（调用工具）
 *   M  — Memory（写 Daily Log + Mem0）
 */

export interface RunnerContext {
  agentId: string;
  soul: string;
  workDir: string;
}

export interface RunnerDeps {
  llm: import('../adapter/index.js').LLMAdapter;
  ioRegistry: import('../io/index.js').IORegistry;
  toolRegistry: import('../tools/index.js').ToolRegistry;
  memory: import('../memory/index.js').MemoryLayer2;
  mem0: import('../mem0/index.js').Mem0Client;
  logger: import('../logger/index.js').Logger;
}

export { createRunner } from './runner.js';
