import { spawnSync } from 'node:child_process';
import type { Tool } from '../index.js';

/**
 * run_agent — 启动子 Agent（exec 调用）
 * 协议文档：doc/protocols/run-agent-contract.md（待建）
 */
export const runAgentTool: Tool = {
  name: 'run_agent',
  description: 'Spawn a sub-agent process. Args: path (required), args (string[]), once (bool).',
  async call(args) {
    const agentPath = String(args['path'] ?? '');
    if (!agentPath) return { ok: false, output: 'Missing required argument: path' };
    const extraArgs: string[] = Array.isArray(args['args']) ? args['args'].map(String) : [];
    const mode = args['once'] ? ['--once'] : [];
    const result = spawnSync(
      'node',
      ['dist/cli/index.js', '--dir', agentPath, ...mode, ...extraArgs],
      { encoding: 'utf8', timeout: 60_000 }
    );
    return {
      ok: result.status === 0,
      output: [result.stdout, result.stderr].filter(Boolean).join('\n'),
    };
  },
};
