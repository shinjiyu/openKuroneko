/**
 * M7 · Loop Scheduler
 *
 * 三种循环模式：
 *   once     — 单次执行后退出
 *   interval — 每隔 intervalMs 执行一次
 *   fast     — 上一次 LLM 调用结束后立即开始下一次（含防空转退避）
 */

export interface LoopOptions {
  mode: 'once' | 'interval' | 'fast';
  intervalMs?: number;
  /** fast 模式：连续空转（无 input）多少轮后触发退避 */
  idleThreshold?: number;
  /** fast 模式：退避基准 ms（指数退避，最大 maxBackoffMs） */
  backoffBaseMs?: number;
  maxBackoffMs?: number;
}

export type TickFn = () => Promise<void>;

export interface LoopScheduler {
  start(tick: TickFn): void;
  stop(): void;
}

export { createLoopScheduler } from './scheduler.js';
