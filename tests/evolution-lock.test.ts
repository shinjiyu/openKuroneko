import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { releaseLock, tryAcquireLock } from '../src/evolution/lock-file.js';

describe('evolution lock-file', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-lock-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('同进程可重入获取锁', () => {
    expect(tryAcquireLock(dir).ok).toBe(true);
    expect(tryAcquireLock(dir).ok).toBe(true);
    releaseLock(dir);
    expect(fs.existsSync(path.join(dir, '.self-evolution', 'lock'))).toBe(false);
  });
});
