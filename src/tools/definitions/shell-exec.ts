/**
 * shell_exec — 在工作目录内执行 shell 命令
 *
 * 安全约束：cwd 必须在 workDir / tempDir / allowedDirs 内（通过 WorkDirGuard）
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { getWorkDir, isPathAllowed, pathSecurityError } from './workdir-guard.js';
import type { Tool } from '../index.js';

export const shellExecTool: Tool = {
  name: 'shell_exec',
  description:
    'Execute a shell command within the agent workDir. ' +
    'command (required): shell command to run. ' +
    'cwd (optional): must be inside workDir (defaults to workDir). ' +
    'timeout (optional): ms, default 30000.',

  async call(args): Promise<{ ok: boolean; output: string }> {
    const cmd     = String(args['command'] ?? '').trim();
    const cwdArg  = args['cwd'] != null ? String(args['cwd']) : getWorkDir();
    const timeout = Number(args['timeout'] ?? 30_000);

    if (!cmd) return { ok: false, output: 'Missing required argument: command' };

    const resolvedCwd = path.resolve(cwdArg);
    if (!isPathAllowed(resolvedCwd)) {
      return { ok: false, output: pathSecurityError(resolvedCwd) };
    }

    try {
      const output = execSync(cmd, { cwd: resolvedCwd, encoding: 'utf8', timeout });
      return { ok: true, output };
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, output: [err.stdout, err.stderr, err.message].filter(Boolean).join('\n') };
    }
  },
};
