import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemoryLayer2 } from '../src/memory/index.js';

let TMP: string;

beforeEach(() => {
  TMP = path.join(os.tmpdir(), `kuroneko-test-mem-${Date.now()}`);
  fs.mkdirSync(TMP, { recursive: true });
});

describe('MemoryLayer2', () => {
  it('TASKS starts empty', () => {
    const mem = createMemoryLayer2(TMP);
    expect(mem.readTasks()).toBe('');
  });

  it('writeTasks / readTasks round-trips', () => {
    const mem = createMemoryLayer2(TMP);
    mem.writeTasks('# My Tasks\n- [ ] item');
    expect(mem.readTasks()).toContain('My Tasks');
  });

  it('writeTasks overwrites', () => {
    const mem = createMemoryLayer2(TMP);
    mem.writeTasks('first');
    mem.writeTasks('second');
    expect(mem.readTasks()).toBe('second');
  });

  it('daily log starts empty', () => {
    const mem = createMemoryLayer2(TMP);
    expect(mem.readDailyLog()).toBe('');
  });

  it('appendDailyLog accumulates entries', () => {
    const mem = createMemoryLayer2(TMP);
    mem.appendDailyLog('entry one');
    mem.appendDailyLog('entry two');
    const log = mem.readDailyLog();
    expect(log).toContain('entry one');
    expect(log).toContain('entry two');
  });
});
