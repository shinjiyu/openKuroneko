#!/usr/bin/env node
/**
 * 自演化 CLI — kuroneko-evolve
 *
 * Usage:
 *   kuroneko-evolve [--repo <path>] begin [--allow-dirty]
 *   kuroneko-evolve [--repo <path>] verify [--cmd "<shell command>"]
 *   kuroneko-evolve [--repo <path>] commit -m "message"
 *   kuroneko-evolve [--repo <path>] rollback
 *   kuroneko-evolve [--repo <path>] status
 *
 * 协议：doc/protocols/self-evolution.md
 */

import { Command } from 'commander';
import path from 'node:path';

import { EvolutionGate } from '../evolution/gate.js';

function repoFrom(cmd: Command): string {
  const parent = cmd.parent;
  const opts = (parent?.opts() ?? {}) as { repo?: string };
  const r = opts.repo ?? process.cwd();
  return path.resolve(r);
}

const program = new Command();

program
  .name('kuroneko-evolve')
  .description('openKuroneko 自演化事务（Git 快照 + verify + commit/rollback）')
  .option('--repo <path>', 'Git 仓库根目录', process.cwd());

const beginCmd = program.command('begin').description('开始事务：记录 HEAD，可选 stash 脏工作区');
beginCmd.option('--allow-dirty', '工作区脏时自动 git stash push -u', false);
beginCmd.action((opts: { allowDirty?: boolean }, cmd: Command) => {
  const repo = repoFrom(cmd);
  const gate = new EvolutionGate(repo);
  const r = gate.begin({ allowDirty: opts.allowDirty === true });
  if (!r.ok) {
    process.stderr.write(`${r.error ?? 'begin 失败'}\n`);
    process.exit(1);
  }
  process.stdout.write(`begin 成功 base_sha=${r.base_sha} stashed=${r.stashed === true}\n`);
});

program
  .command('verify')
  .description('运行验证命令（默认 npm run build）')
  .option('--cmd <command>', 'shell 命令', 'npm run build')
  .action((opts: { cmd: string }, cmd: Command) => {
    const repo = repoFrom(cmd);
    const gate = new EvolutionGate(repo);
    const r = gate.verify({ command: opts.cmd });
    if (!r.ok) {
      if (r.stdout) process.stderr.write(`--- stdout ---\n${r.stdout}\n`);
      if (r.stderr) process.stderr.write(`--- stderr ---\n${r.stderr}\n`);
      process.stderr.write(`${r.error ?? 'verify 失败'}\n`);
      const code = r.exitCode;
      process.exit(code !== undefined && code > 0 && code < 256 ? code : 1);
    }
    process.stdout.write(`verify 通过 (${r.durationMs ?? 0} ms)\n`);
  });

program
  .command('commit')
  .description('git add -A && git commit（需先 begin）')
  .requiredOption('-m, --message <text>', '提交说明')
  .action((opts: { message: string }, cmd: Command) => {
    const repo = repoFrom(cmd);
    const gate = new EvolutionGate(repo);
    const r = gate.commit(opts.message);
    if (!r.ok) {
      process.stderr.write(`${r.error ?? 'commit 失败'}\n`);
      process.exit(1);
    }
    process.stdout.write(`commit 成功 ${r.commit_sha ?? ''}\n`);
  });

program
  .command('rollback')
  .description('reset --hard 到 begin 时的 HEAD，并尝试 stash pop')
  .action((_opts: unknown, cmd: Command) => {
    const repo = repoFrom(cmd);
    const gate = new EvolutionGate(repo);
    const r = gate.rollback();
    if (!r.ok) {
      process.stderr.write(`${r.error ?? 'rollback 失败'}\n`);
      process.exit(1);
    }
    process.stdout.write('rollback 完成\n');
  });

program
  .command('status')
  .description('打印 state.json 解析结果')
  .action((_opts: unknown, cmd: Command) => {
    const repo = repoFrom(cmd);
    const gate = new EvolutionGate(repo);
    const s = gate.getState();
    process.stdout.write(JSON.stringify(s, null, 2) + '\n');
  });

program.parse(process.argv);
