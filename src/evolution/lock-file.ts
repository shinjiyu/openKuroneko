/**
 * .self-evolution/lock — 单写者互斥（协议见 doc/protocols/self-evolution.md）
 */

import fs from 'node:fs';
import path from 'node:path';

import { lockPath } from './paths.js';

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

export function tryAcquireLock(repoRoot: string): { ok: true } | { ok: false; error: string } {
  const file = lockPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const pid = parseInt(raw, 10);
    if (!Number.isNaN(pid) && pid === process.pid) {
      return { ok: true };
    }
    if (!Number.isNaN(pid) && isPidAlive(pid)) {
      return { ok: false, error: `自演化锁已被进程 ${pid} 持有（${file}）` };
    }
    try {
      fs.rmSync(file, { force: true });
    } catch {
      return { ok: false, error: `无法清除陈旧锁：${file}` };
    }
  }

  try {
    fs.writeFileSync(file, String(process.pid), 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `无法写入锁文件：${e instanceof Error ? e.message : String(e)}` };
  }
}

export function releaseLock(repoRoot: string): void {
  const file = lockPath(repoRoot);
  if (!fs.existsSync(file)) return;
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (raw === String(process.pid)) fs.rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
}
