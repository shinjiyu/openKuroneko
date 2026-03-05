#!/usr/bin/env node
/**
 * Entry / CLI  (M1)
 *
 * Usage:
 *   kuroneko --dir <agentPath> [--workspace <workDir>]
 *            [--once | --loop fast | --loop interval --interval-ms 60000]
 */

import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';

import { resolveIdentity, acquirePathLock, releasePathLock } from '../identity/index.js';
import { loadConfig, watchSoul } from '../config/index.js';
import { createIORegistry, createFileInputEndpoint, createFileOutputEndpoint } from '../io/index.js';
import { createMemoryLayer2 } from '../memory/index.js';
import { createMem0Client } from '../mem0/index.js';
import { createLogger } from '../logger/index.js';
import { createOpenAIAdapter } from '../adapter/index.js';
import { createRunner } from '../runner/index.js';
import type { RunnerContext } from '../runner/index.js';
import { createLoopScheduler } from '../loop/index.js';
import { createToolRegistry } from '../tools/index.js';
import {
  readFileTool, writeFileTool, editFileTool, shellExecTool,
  webSearchTool, getTimeTool, replyToMasterTool, runAgentTool,
  readWriteStateTool, capabilityGapTool, setCapabilityGapTempDir,
  listAgentsTool, stopAgentTool, setReplyWriter, seekContextTool,
} from '../tools/definitions/index.js';
import { setStateAccessors } from '../tools/definitions/read-write-state.js';
import { setWorkDirGuard } from '../tools/definitions/workdir-guard.js';

// ── CLI Definition ────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('kuroneko')
  .description('Lightweight multi-agent AI system (openKuroneko)')
  .requiredOption('--dir <path>', 'Agent directory path (determines identity)')
  .option('--workspace <path>', 'Working directory for file operations (default: --dir)')
  .option('--once', 'Run a single R-CCAM loop then exit')
  .option('--loop <mode>', 'Loop mode when not --once: fast | interval', 'fast')
  .option('--interval-ms <ms>', 'Tick interval for --loop interval (ms)', '60000')
  .parse(process.argv);

const opts = program.opts<{
  dir: string;
  workspace?: string;
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

  // M11 — Logger (first, so everything else can log)
  const logger = createLogger(identity.agentId, identity.tempDir);
  logger.info('cli', {
    event: 'agent.start',
    data: { agentId: identity.agentId, agentPath: identity.agentPath, workDir: identity.workDir },
  });

  // M2 — Config & Soul (hot-reload)
  // Persist agentPath into config so list_agents can display it
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
  const soulWatcher = watchSoul(identity.tempDir, (soul) => {
    runnerCtx.soul = soul;
    logger.info('config', { event: 'soul.reloaded', data: { len: soul.length } });
  });

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

  // M8 — Tools
  setWorkDirGuard(identity.workDir, identity.tempDir);
  setCapabilityGapTempDir(identity.tempDir);
  setReplyWriter(async (msg) => {
    await ioRegistry.getOutput('default')?.write(msg);
    logger.info('io', { event: 'output.write', data: { endpointId: 'default', preview: msg.slice(0, 80) } });
  });
  setStateAccessors(
    () => memory.readTasks(),
    (c) => memory.writeTasks(c)
  );

  const toolRegistry = createToolRegistry([
    readFileTool, writeFileTool, editFileTool, shellExecTool,
    webSearchTool, getTimeTool, replyToMasterTool, runAgentTool,
    readWriteStateTool, capabilityGapTool,
    listAgentsTool, stopAgentTool, seekContextTool,
  ]);

  // M10 — LLM Adapter
  const llm = createOpenAIAdapter(config.model ? { model: config.model } : {});

  // M9 — R-CCAM Runner context (mutable so soul hot-reload propagates)
  const runnerCtx: RunnerContext = {
    agentId: identity.agentId,
    soul: soulWatcher.getSoul(),
    workDir: identity.workDir,
    tempDir: identity.tempDir,
  };

  const runner = createRunner(runnerCtx, { llm, ioRegistry, toolRegistry, memory, mem0, logger });

  // M7 — Loop Scheduler
  const loopMode = opts.once
    ? 'once'
    : (config.loopMode ?? (opts.loop as 'fast' | 'interval' | 'once'));

  const scheduler = createLoopScheduler({
    mode: loopMode,
    intervalMs: config.intervalMs ?? Number(opts.intervalMs),
  });

  await scheduler.start(async (): Promise<boolean> => {
    const result = await runner.run();
    return result.hadWork;
  });

  // once mode: start() already awaited the tick
  if (loopMode === 'once') {
    soulWatcher.stop();
    releasePathLock(identity);
    logger.info('cli', { event: 'agent.exit', data: { mode: 'once' } });
    process.exit(0);
  }
}

main().catch((e: unknown) => {
  console.error('[kuroneko] Fatal error:', e);
  process.exit(1);
});
