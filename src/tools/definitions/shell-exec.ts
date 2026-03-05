import { execSync } from 'node:child_process';
import type { Tool } from '../index.js';

export const shellExecTool: Tool = {
  name: 'shell_exec',
  description: 'Execute a shell command in the working directory. Returns stdout+stderr.',
  async call(args) {
    const cmd = String(args['command'] ?? '');
    const cwd = String(args['cwd'] ?? process.cwd());
    if (!cmd) return { ok: false, output: 'Missing required argument: command' };
    try {
      const output = execSync(cmd, { cwd, encoding: 'utf8', timeout: 30_000 });
      return { ok: true, output };
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, output: [err.stdout, err.stderr, err.message].filter(Boolean).join('\n') };
    }
  },
};
