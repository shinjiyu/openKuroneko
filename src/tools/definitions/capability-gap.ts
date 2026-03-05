import type { Tool } from '../index.js';

/**
 * capability_gap_handler — 能力缺口元规则
 *
 * 本轮仅标记缺口，下一轮通过 web_search + write_file 自举。
 */
export const capabilityGapTool: Tool = {
  name: 'capability_gap_handler',
  description: 'Mark a capability gap for self-bootstrapping in the next loop round.',
  async call(args) {
    const gap = String(args['gap'] ?? '');
    const reason = String(args['reason'] ?? '');
    if (!gap) return { ok: false, output: 'Missing required argument: gap' };
    const record = JSON.stringify({ gap, reason, ts: new Date().toISOString() });
    return {
      ok: true,
      output: `Capability gap recorded: ${record}. Will self-bootstrap next round.`,
    };
  },
};
