import { describe, it, expect, vi } from 'vitest';
import { createLoopScheduler } from '../src/loop/index.js';

describe('LoopScheduler — once', () => {
  it('calls tick exactly once', async () => {
    const tick = vi.fn().mockResolvedValue(true);
    const s = createLoopScheduler({ mode: 'once' });
    await s.start(tick);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('awaits async tick before resolving', async () => {
    let done = false;
    const tick = vi.fn(async () => { done = true; return true; });
    const s = createLoopScheduler({ mode: 'once' });
    await s.start(tick);
    expect(done).toBe(true);
  });
});

describe('LoopScheduler — interval', () => {
  it('calls tick multiple times over interval', async () => {
    vi.useFakeTimers();
    const tick = vi.fn().mockResolvedValue(false);
    const s = createLoopScheduler({ mode: 'interval', intervalMs: 100 });
    s.start(tick); // not awaited (runs indefinitely)

    // let microtasks flush so first async tick resolves
    await Promise.resolve();
    await Promise.resolve();
    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(1);

    // advance clock for 2 more ticks
    await vi.advanceTimersByTimeAsync(250);
    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(2);

    s.stop();
    vi.useRealTimers();
  });
});

describe('LoopScheduler — fast (anti-idle)', () => {
  it('backs off after idleThreshold empty ticks', async () => {
    // Use real timers; tick is sync-fast so we can accumulate quickly
    const ticks: number[] = [];
    const tick = vi.fn(async () => {
      ticks.push(Date.now());
      return false; // always idle
    });

    const s = createLoopScheduler({
      mode: 'fast',
      idleThreshold: 3,
      backoffBaseMs: 300,
      maxBackoffMs: 1000,
    });
    s.start(tick);

    // Let the fast loop spin through idleThreshold rounds (setImmediate-based)
    await new Promise<void>((r) => setTimeout(r, 50));
    const countAfterIdle = ticks.length;
    expect(countAfterIdle).toBeGreaterThanOrEqual(3);

    // After backoff, minimal advance should not produce more ticks
    const before = ticks.length;
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(ticks.length).toBe(before); // backoff timer (300ms) not yet expired

    s.stop();
  }, 5000);
});
