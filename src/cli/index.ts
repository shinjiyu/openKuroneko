#!/usr/bin/env node
/**
 * Entry / CLI  (M1)
 *
 * Usage:
 *   kuroneko --dir <agentPath> [--workspace <workDir>]
 *            --goal "完成目标..." | --goal-file path/to/goal.md
 *            [--once | --loop fast | --loop interval --interval-ms 60000]
 */

import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';

import { resolveIdentity, acquirePathLock, releasePathLock } from '../identity/index.js';
import { loadConfig } from '../config/index.js';
import { createIORegistry, createFileInputEndpoint, createFileOutputEndpoint } from '../io/index.js';
import { createMemoryLayer2 } from '../memory/index.js';
import { createMem0Client } from '../mem0/index.js';
import { createLogger } from '../logger/index.js';
import { createOpenAIAdapter } from '../adapter/index.js';
import { createController } from '../controller/index.js';
import type { ControllerContext } from '../controller/index.js';
import { createLoopScheduler } from '../loop/index.js';
import { createToolRegistry } from '../tools/index.js';
import {
  readFileTool, writeFileTool, editFileTool, shellExecTool,
  webSearchTool, getTimeTool, runAgentTool,
  capabilityGapTool, setCapabilityGapTempDir,
  listAgentsTool, stopAgentTool,
  writeConstraintTool, writeSkillTool, writeKnowledgeTool,
} from '../tools/definitions/index.js';
import { setWorkDirGuard } from '../tools/definitions/workdir-guard.js';
import { BrainFS } from '../brain/index.js';
import { createFilesystemStore } from '../archive/index.js';

// ── CLI Definition ────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('kuroneko')
  .description('Lightweight multi-agent AI system (openKuroneko) — pi-mono evolutionary loop')
  .requiredOption('--dir <path>', 'Agent directory path (determines identity)')
  .option('--workspace <path>', 'Working directory for file operations (default: --dir)')
  .option('--goal <text>', 'Goal text to write into .brain/goal.md on startup')
  .option('--goal-file <path>', 'Path to a goal.md file to copy into .brain/goal.md on startup')
  .option('--once', 'Run a single loop tick then exit')
  .option('--loop <mode>', 'Loop mode when not --once: fast | interval', 'fast')
  .option('--interval-ms <ms>', 'Tick interval for --loop interval (ms)', '60000')
  .parse(process.argv);

const opts = program.opts<{
  dir: string;
  workspace?: string;
  goal?: string;
  goalFile?: string;
  once?: boolean;
  loop: string;
  intervalMs: string;
}>();

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function main() {
  // M1 — Identity & path lock
  const identity = resolveIdentity(opts.dir, opts.workspace);
  acquirePathLock(identity);

  const cleanup = () => {
    releasePathLock(identity);
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // M11 — Logger
  const logger = createLogger(identity.agentId, identity.tempDir);
  logger.info('cli', {
    event: 'agent.start',
    data: { agentId: identity.agentId, agentPath: identity.agentPath, workDir: identity.workDir },
  });

  // M2 — Config
  const configPath = path.join(identity.tempDir, 'agent.config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ agentPath: identity.agentPath }, null, 2), 'utf8');
  } else {
    try {
      const existing = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      if (!existing['agentPath']) {
        existing['agentPath'] = identity.agentPath;
        fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf8');
      }
    } catch { /* ignore */ }
  }
  const config = loadConfig(identity.tempDir);

  // M12 — 初始化 .brain/ 目录 & goal.md
  const brain = new BrainFS(identity.workDir);

  if (opts.goal) {
    // 新 goal 传入 → 归档旧任务的 brain，从干净状态开始
    brain.archiveForNewTask();
    brain.writeGoal(opts.goal);
    logger.info('cli', { event: 'goal.set', data: { preview: opts.goal.slice(0, 100) } });
  } else if (opts.goalFile) {
    const goalContent = fs.readFileSync(path.resolve(opts.goalFile), 'utf8');
    brain.archiveForNewTask();
    brain.writeGoal(goalContent);
    logger.info('cli', { event: 'goal.set.file', data: { file: opts.goalFile } });
  } else if (!brain.readGoal().trim()) {
    // 既无 --goal 又无 goal.md → 日志警告，控制器启动后会 BLOCK
    logger.warn('cli', { event: 'goal.missing', data: { msg: 'No --goal or --goal-file provided, and .brain/goal.md is empty. Controller will BLOCK on first tick.' } });
  }

  // M3 — I/O Registry
  const ioRegistry = createIORegistry();
  const inputPath  = path.join(identity.tempDir, 'input');
  const outputPath = path.join(identity.tempDir, 'output');
  ioRegistry.registerInput(createFileInputEndpoint('default', inputPath));
  ioRegistry.registerOutput(createFileOutputEndpoint('default', outputPath));
  for (const ep of config.endpoints ?? []) {
    if (ep.inputPath)  ioRegistry.registerInput(createFileInputEndpoint(ep.id, ep.inputPath));
    if (ep.outputPath) ioRegistry.registerOutput(createFileOutputEndpoint(ep.id, ep.outputPath));
  }

  // M5 — Memory L2
  const memory = createMemoryLayer2(identity.tempDir);

  // M6 — Mem0 (L3)
  const mem0 = createMem0Client();

  // M8 — Tools setup
  setWorkDirGuard(identity.workDir, identity.tempDir);
  setCapabilityGapTempDir(identity.tempDir);

  // Executor 工具集：全套标准工具
  const executorToolRegistry = createToolRegistry([
    readFileTool, writeFileTool, editFileTool, shellExecTool,
    webSearchTool, getTimeTool, runAgentTool,
    capabilityGapTool,
    listAgentsTool, stopAgentTool,
  ]);

  // Attributor 工具集：仅归因专用工具
  const attributorToolRegistry = createToolRegistry([
    writeConstraintTool, writeSkillTool, writeKnowledgeTool,
  ]);

  // M10 — LLM Adapter
  const llm = createOpenAIAdapter(config.model ? { model: config.model } : {});

  // M12.5 — Knowledge Archive（文件系统实现，并发安全，后续可换 Mem0Store）
  const knowledgeStore = createFilesystemStore();

  // M9 — Controller
  const controllerCtx: ControllerContext = {
    agentId: identity.agentId,
    workDir: identity.workDir,
    tempDir: identity.tempDir,
  };

  const controller = createController(controllerCtx, {
    llm,
    ioRegistry,
    executorToolRegistry,
    attributorToolRegistry,
    memory,
    mem0,
    logger,
    knowledgeStore,
  });

  // M7 — Loop Scheduler
  const loopMode = opts.once
    ? 'once'
    : (config.loopMode ?? (opts.loop as 'fast' | 'interval' | 'once'));

  const scheduler = createLoopScheduler({
    mode: loopMode,
    intervalMs: config.intervalMs ?? Number(opts.intervalMs),
  });

  await scheduler.start(async (): Promise<boolean> => {
    const result = await controller.tick();
    return result.hadWork;
  });

  if (loopMode === 'once') {
    releasePathLock(identity);
    logger.info('cli', { event: 'agent.exit', data: { mode: 'once' } });
    process.exit(0);
  }
}

main().catch((e: unknown) => {
  console.error('[kuroneko] Fatal error:', e);
  process.exit(1);
});
