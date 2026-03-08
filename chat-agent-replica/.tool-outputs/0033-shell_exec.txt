/**
 * InnerBrainManager — 内脑进程生命周期管理
 *
 * 职责：
 * - 按需启动内脑（set_goal 时自动调用）
 * - PID 文件持久化（<obDir>/inner-brain.pid），进程重启后可恢复感知
 * - 检测内脑是否存活（isRunning）
 * - 优雅停止（SIGTERM → 等待 → SIGKILL）
 * - 内脑退出时回调（用于 push-loop 感知 COMPLETE 后停止内脑）
 *
 * 启动命令：通过传入的 `launchCommand` 数组 spawn 内脑进程。
 * 例：["node", "dist/cli/index.js", "--dir", "./chat-agent", "--loop", "fast"]
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '../logger/index.js';

export interface InnerBrainManagerOptions {
  /** 外脑工作目录（存放 inner-brain.pid） */
  obDir: string;
  /**
   * 启动内脑的命令数组。
   * 示例：["node", "/path/to/dist/cli/index.js", "--dir", "./chat-agent"]
   */
  launchCommand: string[];
  /** 内脑工作目录（spawn 时的 cwd） */
  innerDir: string;
  logger: Logger;
  /** 内脑退出时回调（exitCode, signal） */
  onExit?: (code: number | null, signal: string | null) => void;
}

export class InnerBrainManager {
  private readonly opts: InnerBrainManagerOptions;
  private readonly pidFile: string;
  private child: ChildProcess | null = null;

  constructor(opts: InnerBrainManagerOptions) {
    this.opts    = opts;
    this.pidFile = path.join(opts.obDir, 'inner-brain.pid');
  }

  /**
   * 检查内脑是否正在运行。
   * 先查本进程持有的 child，再查 PID 文件（跨进程重启感知）。
   */
  isRunning(): boolean {
    // 本进程内持有的 child
    if (this.child && this.child.exitCode === null) {
      return true;
    }
    // PID 文件（由上一次启动写入）
    const pid = this.readPid();
    if (pid === null) return false;
    try {
      process.kill(pid, 0); // 信号 0 = 仅检测是否存在
      return true;
    } catch {
      this.clearPid();
      return false;
    }
  }

  /**
   * 启动内脑进程（幂等：已运行则直接返回）。
   * 返回是否实际执行了启动。
   */
  launch(): boolean {
    if (this.isRunning()) {
      this.opts.logger.info('inner-brain-mgr', {
        event: 'launch.skipped',
        data: { reason: 'already running' },
      });
      return false;
    }

    const [cmd, ...args] = this.opts.launchCommand;
    if (!cmd) throw new Error('launchCommand is empty');

    this.child = spawn(cmd, args, {
      cwd:   this.opts.innerDir,
      stdio: 'inherit',    // 日志直接透传到外脑进程的 stdout/stderr
      detached: false,
    });

    const pid = this.child.pid;
    if (pid) this.writePid(pid);

    this.opts.logger.info('inner-brain-mgr', {
      event: 'launch',
      data:  { pid, cmd: this.opts.launchCommand.join(' ') },
    });

    this.child.on('exit', (code, signal) => {
      this.opts.logger.info('inner-brain-mgr', {
        event: 'exit',
        data:  { code, signal },
      });
      this.clearPid();
      this.child = null;
      this.opts.onExit?.(code, signal);
    });

    this.child.on('error', (err) => {
      this.opts.logger.error('inner-brain-mgr', {
        event: 'spawn.error',
        data:  { error: err.message },
      });
    });

    return true;
  }

  /**
   * 停止内脑进程。
   * 先发 SIGTERM，等待 timeoutMs 后若仍在运行则 SIGKILL。
   */
  async stop(timeoutMs = 10_000): Promise<void> {
    const pid = this.child?.pid ?? this.readPid();
    if (!pid) return;

    this.opts.logger.info('inner-brain-mgr', {
      event: 'stop',
      data:  { pid },
    });

    try {
      process.kill(pid, 'SIGTERM');
    } catch { /* 可能已退出 */ }

    // 等待进程退出
    const deadline = Date.now() + timeoutMs;
    while (this.isRunning() && Date.now() < deadline) {
      await sleep(500);
    }

    if (this.isRunning()) {
      this.opts.logger.warn('inner-brain-mgr', {
        event: 'sigkill',
        data:  { pid },
      });
      try { process.kill(pid, 'SIGKILL'); } catch { /* 忽略 */ }
    }

    this.clearPid();
    this.child = null;
  }

  // ── PID 文件 ───────────────────────────────────────────────────────────────

  private writePid(pid: number): void {
    fs.writeFileSync(this.pidFile, String(pid), 'utf8');
  }

  private readPid(): number | null {
    if (!fs.existsSync(this.pidFile)) return null;
    const n = parseInt(fs.readFileSync(this.pidFile, 'utf8').trim(), 10);
    return isNaN(n) ? null : n;
  }

  private clearPid(): void {
    try { fs.unlinkSync(this.pidFile); } catch { /* 已不存在 */ }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
