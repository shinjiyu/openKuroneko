import type { LoopOptions, LoopScheduler, TickFn } from './index.js';

export function createLoopScheduler(opts: LoopOptions): LoopScheduler {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    async start(tick: TickFn): Promise<void> {
      if (opts.mode === 'once') {
        await tick().catch(console.error);
        return;
      }

      if (opts.mode === 'interval') {
        const ms = opts.intervalMs ?? 60_000;
        const loop = async () => {
          if (stopped) return;
          await tick().catch(console.error);
          if (!stopped) timer = setTimeout(loop, ms);
        };
        void loop();
        return;
      }

      // ── fast mode with anti-idle exponential backoff ──────────────
      const idleThreshold = opts.idleThreshold ?? 3;
      const backoffBase   = opts.backoffBaseMs ?? 500;
      const maxBackoff    = opts.maxBackoffMs  ?? 30_000;
      let idleCount = 0;

      const loop = async () => {
        if (stopped) return;

        let hadWork = false;
        try {
          hadWork = await tick();
        } catch {
          hadWork = false;
        }

        if (stopped) return;

        if (hadWork) {
          idleCount = 0;
          setImmediate(loop);
        } else {
          idleCount++;
          if (idleCount >= idleThreshold) {
            const backoffMs = Math.min(backoffBase * 2 ** (idleCount - idleThreshold), maxBackoff);
            timer = setTimeout(loop, backoffMs);
          } else {
            setImmediate(loop);
          }
        }
      };

      void loop();
    },

    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
