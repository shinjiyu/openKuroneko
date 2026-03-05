import type { LoopOptions, LoopScheduler, TickFn } from './index.js';

export function createLoopScheduler(opts: LoopOptions): LoopScheduler {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    start(tick: TickFn): void {
      if (opts.mode === 'once') {
        tick().catch(console.error);
        return;
      }

      if (opts.mode === 'interval') {
        const ms = opts.intervalMs ?? 60_000;
        const loop = async () => {
          if (stopped) return;
          await tick().catch(console.error);
          if (!stopped) timer = setTimeout(loop, ms);
        };
        loop();
        return;
      }

      // fast mode with anti-idle backoff
      const idleThreshold = opts.idleThreshold ?? 3;
      const backoffBase = opts.backoffBaseMs ?? 500;
      const maxBackoff = opts.maxBackoffMs ?? 30_000;
      let idleCount = 0;

      const loop = async () => {
        if (stopped) return;
        const hadWork = await runTickWithWorkDetection(tick);
        if (hadWork) {
          idleCount = 0;
          setImmediate(loop);
        } else {
          idleCount++;
          if (idleCount >= idleThreshold) {
            const delay = Math.min(backoffBase * 2 ** (idleCount - idleThreshold), maxBackoff);
            timer = setTimeout(loop, delay);
          } else {
            setImmediate(loop);
          }
        }
      };
      loop();
    },

    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

async function runTickWithWorkDetection(tick: TickFn): Promise<boolean> {
  // tick 有实际工作时返回 true（暂以是否抛错为判断依据，后续可扩展）
  try {
    await tick();
    return true;
  } catch {
    return false;
  }
}
