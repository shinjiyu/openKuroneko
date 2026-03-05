#!/usr/bin/env node
/**
 * M1 Entry / CLI
 *
 * Usage:
 *   kuroneko --dir <agentPath> [--workspace <workDir>] [--once | --loop fast | --loop interval --interval-ms 60000]
 */

import { Command } from 'commander';
import { acquirePathLock, releasePathLock, resolveIdentity } from '../identity/index.js';
import { loadConfig, watchSoul } from '../config/index.js';
import { createIORegistry, createFileInputEndpoint, createFileOutputEndpoint } from '../io/index.js';
import { createMemoryLayer2 } from '../memory/index.js';
import { createMem0Client } from '../mem0/index.js';
import { createLogger } from '../logger/index.js';
import { createOpenAIAdapter } from '../adapter/index.js';
import { createRunner } from '../runner/index.js';
import { createLoopScheduler } from '../loop/index.js';
import {
  readFileTool, writeFileTool, editFileTool, shellExecTool,
  webSearchTool, getTimeTool, replyToUserTool, runAgentTool,
  readWriteStateTool, capabilityGapTool,
} from '../tools/definitions/index.js';
import { setReplyWriter } from '../tools/definitions/reply-to-user.js';
import { setStateAccessors } from '../tools/definitions/read-write-state.js';
import { createToolRegistry } from '../tools/index.js';
import path from 'node:path';

const program = new Command();

program
  .name('kuroneko')
  .description('Lightweight multi-agent AI system')
  .requiredOption('--dir <path>', 'Agent directory path (determines identity)')
  .option('--workspace <path>', 'Working directory for file operations (default: --dir)')
  .option('--once', 'Run a single SCL loop then exit')
  .option('--loop <mode>', 'Loop mode: fast | interval', 'fast')
  .option('--interval-ms <ms>', 'Interval for --loop interval mode (ms)', '60000')
  .option('--config <path>', 'Path to agent.config.json (default: <tempDir>/agent.config.json)')
  .parse(process.argv);

const opts = program.opts<{
  dir: string;
  workspace?: string;
  once?: boolean;
  loop: string;
  intervalMs: string;
  config?: string;
}>();

async function main() {
  // ── Identity & Paths ─────────────────────────────────────────
  const identity = resolveIdentity(opts.dir, opts.workspace);
  acquirePathLock(identity);

  const cleanup = () => {
    releasePathLock(identity);
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // ── Logger ───────────────────────────────────────────────────
  const logger = createLogger(identity.agentId, identity.tempDir);
  logger.info('cli', { event: 'agent.start', data: { agentId: identity.agentId, agentPath: identity.agentPath, workDir: identity.workDir } });

  // ── Config & Soul ────────────────────────────────────────────
  const config = loadConfig(identity.tempDir);
  const soulWatcher = watchSoul(identity.tempDir);
  logger.info('cli', { event: 'soul.loaded', data: { len: soulWatcher.getSoul().length } });

  // ── I/O Registry ─────────────────────────────────────────────
  const ioRegistry = createIORegistry();
  const inputPath = path.join(identity.tempDir, 'input');
  const outputPath = path.join(identity.tempDir, 'output');
  ioRegistry.registerInput(createFileInputEndpoint('default', inputPath));
  ioRegistry.registerOutput(createFileOutputEndpoint('default', outputPath));

  // Register additional endpoints from config
  for (const ep of config.endpoints ?? []) {
    if (ep.inputPath) ioRegistry.registerInput(createFileInputEndpoint(ep.id, ep.inputPath));
    if (ep.outputPath) ioRegistry.registerOutput(createFileOutputEndpoint(ep.id, ep.outputPath));
  }

  // ── Memory & Mem0 ────────────────────────────────────────────
  const memory = createMemoryLayer2(identity.tempDir);
  const mem0 = createMem0Client();

  // ── Tools ────────────────────────────────────────────────────
  setReplyWriter(async (msg) => {
    await ioRegistry.getOutput('default')?.write(msg);
  });
  setStateAccessors(() => memory.readTasks(), (c) => memory.writeTasks(c));

  const toolRegistry = createToolRegistry([
    readFileTool, writeFileTool, editFileTool, shellExecTool,
    webSearchTool, getTimeTool, replyToUserTool, runAgentTool,
    readWriteStateTool, capabilityGapTool,
  ]);

  // ── LLM Adapter ──────────────────────────────────────────────
  const llm = createOpenAIAdapter({ model: config.model });

  // ── Runner ───────────────────────────────────────────────────
  const runner = createRunner(
    { agentId: identity.agentId, soul: soulWatcher.getSoul(), workDir: identity.workDir },
    { llm, ioRegistry, toolRegistry, memory, mem0, logger }
  );

  // hot-reload soul → update runner context next tick
  soulWatcher; // watcher is active; soul re-read via getSoul() each tick

  // ── Loop ─────────────────────────────────────────────────────
  const loopMode = opts.once ? 'once' : (config.loopMode ?? (opts.loop as 'fast' | 'interval' | 'once'));
  const scheduler = createLoopScheduler({
    mode: loopMode,
    intervalMs: config.intervalMs ?? Number(opts.intervalMs),
  });

  scheduler.start(async () => {
    // Re-read soul each tick to support hot-reload
    const soul = soulWatcher.getSoul();
    const tickRunner = createRunner(
      { agentId: identity.agentId, soul, workDir: identity.workDir },
      { llm, ioRegistry, toolRegistry, memory, mem0, logger }
    );
    await tickRunner.run();
  });

  if (loopMode === 'once') {
    soulWatcher.stop();
    releasePathLock(identity);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
