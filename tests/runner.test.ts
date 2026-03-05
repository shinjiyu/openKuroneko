import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createRunner } from '../src/runner/index.js';
import type { RunnerContext, RunnerDeps } from '../src/runner/index.js';
import type { LLMAdapter, LLMResult } from '../src/adapter/index.js';
import type { Logger } from '../src/logger/index.js';
import { createIORegistry, createFileInputEndpoint, createFileOutputEndpoint } from '../src/io/index.js';
import { createMemoryLayer2 } from '../src/memory/index.js';
import { createToolRegistry } from '../src/tools/index.js';
import { getTimeTool, writeFileTool } from '../src/tools/definitions/index.js';
import { setStateAccessors } from '../src/tools/definitions/read-write-state.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

let TMP: string;

beforeEach(() => {
  TMP = path.join(os.tmpdir(), `kuroneko-runner-${Date.now()}`);
  fs.mkdirSync(TMP, { recursive: true });
});

function makeMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
  };
}

function makeMockMem0() {
  return {
    add:    vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
  };
}

function makeCtx(overrides?: Partial<RunnerContext>): RunnerContext {
  return {
    agentId: 'test-agent',
    soul: '## Test Soul\nYou are a test agent.',
    workDir: TMP,
    tempDir: TMP,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Runner — no input, LLM returns text only', () => {
  it('runs once, returns hadWork=false (no input, no tool calls)', async () => {
    const ioRegistry = createIORegistry();
    ioRegistry.registerInput(createFileInputEndpoint('default', path.join(TMP, 'input')));
    ioRegistry.registerOutput(createFileOutputEndpoint('default', path.join(TMP, 'output')));

    const llm: LLMAdapter = {
      chat: vi.fn().mockResolvedValue({ content: 'Nothing to do right now.', toolCalls: [] }),
    };

    const memory = createMemoryLayer2(TMP);
    setStateAccessors(() => memory.readTasks(), (c) => memory.writeTasks(c));

    const deps: RunnerDeps = {
      llm,
      ioRegistry,
      toolRegistry: createToolRegistry([getTimeTool]),
      memory,
      mem0: makeMockMem0(),
      logger: makeMockLogger(),
    };

    const runner = createRunner(makeCtx(), deps);
    const result = await runner.run();

    expect(result.hadWork).toBe(false);
    // LLM was called once (no tool loop)
    expect(llm.chat).toHaveBeenCalledTimes(1);
    // Daily log got the LLM content
    expect(memory.readDailyLog()).toContain('Nothing to do right now.');
  });
});

describe('Runner — with input', () => {
  it('reads input, calls LLM, returns hadWork=true', async () => {
    const inputPath  = path.join(TMP, 'input');
    const outputPath = path.join(TMP, 'output');
    fs.writeFileSync(inputPath, 'Hello, agent!', 'utf8');

    const ioRegistry = createIORegistry();
    ioRegistry.registerInput(createFileInputEndpoint('default', inputPath));
    ioRegistry.registerOutput(createFileOutputEndpoint('default', outputPath));

    const llm: LLMAdapter = {
      chat: vi.fn().mockResolvedValue({ content: 'Hi there!', toolCalls: [] }),
    };
    const memory = createMemoryLayer2(TMP);

    const deps: RunnerDeps = {
      llm,
      ioRegistry,
      toolRegistry: createToolRegistry([getTimeTool]),
      memory,
      mem0: makeMockMem0(),
      logger: makeMockLogger(),
    };

    const runner = createRunner(makeCtx(), deps);
    const result = await runner.run();

    expect(result.hadWork).toBe(true);
    // Input consumed
    expect(await ioRegistry.getInput('default')!.read()).toBeNull();
    // Mem0 search called with the input
    expect(deps.mem0.search).toHaveBeenCalledWith('Hello, agent!', 'test-agent');
  });
});

describe('Runner — tool call loop', () => {
  it('executes a tool and then finishes on second LLM call', async () => {
    const ioRegistry = createIORegistry();
    ioRegistry.registerInput(createFileInputEndpoint('default', path.join(TMP, 'input')));
    ioRegistry.registerOutput(createFileOutputEndpoint('default', path.join(TMP, 'output')));

    // Round 1: LLM asks to call get_time; Round 2: LLM done
    const llm: LLMAdapter = {
      chat: vi.fn()
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{ name: 'get_time', args: {} }],
        } satisfies LLMResult)
        .mockResolvedValueOnce({
          content: 'Done, the time is known.',
          toolCalls: [],
        } satisfies LLMResult),
    };

    const memory = createMemoryLayer2(TMP);
    const logger = makeMockLogger();

    const deps: RunnerDeps = {
      llm,
      ioRegistry,
      toolRegistry: createToolRegistry([getTimeTool]),
      memory,
      mem0: makeMockMem0(),
      logger,
    };

    const runner = createRunner(makeCtx(), deps);
    const result = await runner.run();

    expect(llm.chat).toHaveBeenCalledTimes(2);
    expect(result.hadWork).toBe(true); // no input, but tool was called → hadWork
    // tool.result event logged
    const infoLogs = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const toolResultLog = infoLogs.find(
      ([, p]: [string, { event: string }]) => p.event === 'tool.result'
    );
    expect(toolResultLog).toBeTruthy();
  });
});

describe('Runner — LLM error', () => {
  it('writes error to output endpoint and returns gracefully', async () => {
    const outputPath = path.join(TMP, 'output');
    const ioRegistry = createIORegistry();
    ioRegistry.registerInput(createFileInputEndpoint('default', path.join(TMP, 'input')));
    ioRegistry.registerOutput(createFileOutputEndpoint('default', outputPath));

    const llm: LLMAdapter = {
      chat: vi.fn().mockRejectedValue(new Error('API unavailable')),
    };

    const memory = createMemoryLayer2(TMP);
    const logger = makeMockLogger();

    const deps: RunnerDeps = {
      llm,
      ioRegistry,
      toolRegistry: createToolRegistry([]),
      memory,
      mem0: makeMockMem0(),
      logger,
    };

    const runner = createRunner(makeCtx(), deps);
    // Should not throw
    const result = await runner.run();

    expect(result.hadWork).toBe(false);
    // Error written to output
    const outputContent = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    expect(outputContent).toContain('[ERROR]');
    expect(outputContent).toContain('API unavailable');
    // Error logged
    expect((logger.error as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});

describe('Runner — write_file tool', () => {
  it('creates a file in workDir when LLM calls write_file', async () => {
    const targetFile = path.join(TMP, 'hello.txt');
    const ioRegistry = createIORegistry();
    ioRegistry.registerInput(createFileInputEndpoint('default', path.join(TMP, 'input')));
    ioRegistry.registerOutput(createFileOutputEndpoint('default', path.join(TMP, 'output')));

    const llm: LLMAdapter = {
      chat: vi.fn()
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{ name: 'write_file', args: { path: targetFile, content: 'Hello World' } }],
        } satisfies LLMResult)
        .mockResolvedValueOnce({ content: 'File written.', toolCalls: [] } satisfies LLMResult),
    };

    const memory = createMemoryLayer2(TMP);
    const deps: RunnerDeps = {
      llm,
      ioRegistry,
      toolRegistry: createToolRegistry([writeFileTool]),
      memory,
      mem0: makeMockMem0(),
      logger: makeMockLogger(),
    };

    await createRunner(makeCtx(), deps).run();

    expect(fs.existsSync(targetFile)).toBe(true);
    expect(fs.readFileSync(targetFile, 'utf8')).toBe('Hello World');
  });
});
