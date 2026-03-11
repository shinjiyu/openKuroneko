/**
 * InnerBrainPool — 多实例内脑进程池
 *
 * 职责：
 * - 每次 launch() 创建独立工作目录 + 独立临时目录，拉起新实例
 * - 管理所有活跃/历史实例（Map<instanceId, InstanceRecord>）
 * - 支持按 instanceId 停止特定实例
 * - 通过 tempDir 隔离确保多任务互不污染（解决工作目录跨任务污染问题）
 *
 * 目录结构：
 *   <obDir>/tasks/<instanceId>/     ← 每任务独立工作目录（inner brain --dir 指向此处）
 *   <tempRoot>/<agentId>/           ← 由 resolveIdentity(workDir) 派生，同样独立
 *
 * 实例生命周期：
 *   RUNNING → EXITED（保留记录，历史可查）
 *
 * 最大并发：maxConcurrent（默认 4）
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { Logger } from '../logger/index.js';
import { deriveAgentId, globalTmpDir } from '../identity/index.js';
import { getAgentPoolBrainDir, seedRelevantSkillsToWorkDir } from './agent-pool.js';

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export type InstanceStatus = 'RUNNING' | 'EXITED';

export interface InstanceRecord {
  id:            string;
  workDir:       string;
  tempDir:       string;
  goal:          string;
  originUser:    string;
  /** 下达任务时所在的 thread_id（群聊时用于 COMPLETE/BLOCK 回落通知） */
  originThread?: string;
  status:        InstanceStatus;
  pid:           number | null;
  startedAt:     Date;
  exitCode:      number | null;
  exitSignal:    string | null;
  exitedAt:      Date | null;
}

export interface InnerBrainPoolOptions {
  /** 外脑工作目录（任务子目录 tasks/ 建在这里） */
  obDir: string;
  /**
   * 内脑启动命令模板。
   * 池会自动替换/追加 --dir <workDir>。
   * 例：["node", "/path/to/dist/cli/index.js", "--dir", "./chat-agent", "--loop", "fast"]
   */
  launchCommandTemplate: string[];
  /** 最大并发实例数（默认 4） */
  maxConcurrent?: number;
  logger: Logger;
  /** 实例退出时回调 */
  onInstanceExit?: (instance: InstanceRecord) => void;
}

// ── InnerBrainPool ────────────────────────────────────────────────────────────

export class InnerBrainPool {
  private readonly opts:      InnerBrainPoolOptions;
  private readonly instances: Map<string, InstanceRecord> = new Map();
  private readonly processes: Map<string, ChildProcess>   = new Map();

  private readonly tasksDir: string;
  private readonly maxConcurrent: number;

  constructor(opts: InnerBrainPoolOptions) {
    this.opts          = opts;
    this.tasksDir      = path.join(opts.obDir, 'tasks');
    this.maxConcurrent = opts.maxConcurrent ?? 4;

    fs.mkdirSync(this.tasksDir, { recursive: true });
  }

  // ── 公开接口 ──────────────────────────────────────────────────────────────

  /** 启动新内脑实例，返回 instanceId。如超并发上限则抛出错误。 */
  launch(goal: string, originUser: string, originThread?: string): string {
    const running = this.runningInstances();
    if (running.length >= this.maxConcurrent) {
      throw new Error(
        `已达并发上限 ${this.maxConcurrent}，当前运行中的实例：${running.map(i => i.id).join(', ')}`,
      );
    }

    const id      = this.generateId();
    const workDir = path.join(this.tasksDir, id);
    const tempDir = this.deriveTempDir(workDir);

    // 创建工作目录和临时目录
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'logs'), { recursive: true });

    // 写入初始目标到 input 文件（供 BLOCKED 态消费）
    const inputFile  = path.join(tempDir, 'input');
    const threadLine = originThread ? `origin_thread: ${originThread}\n` : '';
    const message    = `[NEW_GOAL]\norigin_user: ${originUser}\n${threadLine}\n${goal}`;
    fs.writeFileSync(inputFile, message + '\n', 'utf8');
    // offset 从 0 开始（新实例，新文件）
    fs.writeFileSync(path.join(tempDir, 'input.offset'), '0', 'utf8');

    // 同时写入 workDir/.brain/goal.md，避免内脑首 tick 默认 DECOMPOSE 时读到空 goal 直接 BLOCK
    const brainDir = path.join(workDir, '.brain');
    fs.mkdirSync(brainDir, { recursive: true });
    fs.writeFileSync(path.join(brainDir, 'goal.md'), message + '\n', 'utf8');

    // 初始化 status 文件（blocked 必须与 mode 一致：mode===BLOCKED ⇒ blocked===true）
    const initStatus = {
      ts:               new Date().toISOString(),
      mode:             'BLOCKED',
      milestone:        null,
      goal_origin_user: originUser,
      blocked:          true,
      block_reason:     null,
    };
    fs.writeFileSync(path.join(tempDir, 'status'), JSON.stringify(initStatus, null, 2), 'utf8');

    // 按目标选择相关技能注入，避免泛化池全量注入（协议：doc/protocols/agent-pool.md）
    seedRelevantSkillsToWorkDir(this.opts.obDir, workDir, goal, 5);

    // 构建启动命令（替换 --dir 参数）
    const cmd = this.buildCommand(workDir);

    // 记录实例
    const record: InstanceRecord = {
      id,
      workDir,
      tempDir,
      goal,
      originUser,
      ...(originThread ? { originThread } : {}),
      status:    'RUNNING',
      pid:       null,
      startedAt: new Date(),
      exitCode:  null,
      exitSignal: null,
      exitedAt:  null,
    };
    this.instances.set(id, record);

    // 启动进程
    const [prog, ...args] = cmd;
    if (!prog) throw new Error('launchCommandTemplate 为空');

    // Windows: 直接 spawn .cmd/.bat 会触发 EINVAL（Node 安全策略 CVE-2024-27980），必须传 shell: true
    const isWinBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(prog);

    const poolBrainDir = getAgentPoolBrainDir(this.opts.obDir);
    const child = spawn(prog, args, {
      cwd:      workDir,
      stdio:    'inherit',
      detached: false,
      ...(isWinBatch ? { shell: true } : {}),
      env:      {
        ...process.env,
        OPENKURONEKO_OB_SKILL_POOL: fs.existsSync(path.join(poolBrainDir, 'skills.md')) ? poolBrainDir : '',
      },
    });

    if (child.pid) record.pid = child.pid;
    this.processes.set(id, child);

    this.opts.logger.info('inner-brain-pool', {
      event: 'instance.launch',
      data: {
        id,
        pid:     child.pid,
        workDir,
        tempDir,
        cmd:     cmd.join(' '),
        goal:    goal.slice(0, 80),
      },
    });

    child.on('exit', (code, signal) => {
      record.status    = 'EXITED';
      record.exitCode  = code;
      record.exitSignal = signal;
      record.exitedAt  = new Date();
      this.processes.delete(id);

      this.opts.logger.info('inner-brain-pool', {
        event: 'instance.exit',
        data: { id, code, signal },
      });

      this.opts.onInstanceExit?.(record);
    });

    child.on('error', (err) => {
      this.opts.logger.error('inner-brain-pool', {
        event: 'instance.spawn_error',
        data: { id, error: err.message },
      });
    });

    return id;
  }

  /** 停止指定实例。 */
  async stop(instanceId: string, timeoutMs = 10_000): Promise<void> {
    const record = this.instances.get(instanceId);
    if (!record || record.status !== 'RUNNING') return;

    const child = this.processes.get(instanceId);
    const pid   = child?.pid ?? record.pid;

    this.opts.logger.info('inner-brain-pool', {
      event: 'instance.stop',
      data: { id: instanceId, pid },
    });

    if (pid) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* 可能已退出 */ }
    }

    // 等待进程退出
    const deadline = Date.now() + timeoutMs;
    while (record.status === 'RUNNING' && Date.now() < deadline) {
      await sleep(300);
    }

    if (record.status === 'RUNNING' && pid) {
      this.opts.logger.warn('inner-brain-pool', {
        event: 'instance.sigkill',
        data: { id: instanceId, pid },
      });
      try { process.kill(pid, 'SIGKILL'); } catch { /* 忽略 */ }
    }
  }

  /** 停止所有运行中的实例。 */
  async stopAll(timeoutMs = 10_000): Promise<void> {
    await Promise.all(
      this.runningInstances().map((r) => this.stop(r.id, timeoutMs)),
    );
  }

  /** 获取指定实例记录。 */
  get(instanceId: string): InstanceRecord | undefined {
    return this.instances.get(instanceId);
  }

  /** 返回所有实例记录（包含已退出的），按启动时间降序。 */
  list(): InstanceRecord[] {
    return Array.from(this.instances.values())
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  /** 返回所有运行中的实例。 */
  runningInstances(): InstanceRecord[] {
    return this.list().filter((r) => r.status === 'RUNNING');
  }

  /** 检查是否有任何实例在运行。 */
  isAnyRunning(): boolean {
    return this.runningInstances().length > 0;
  }

  /** 检查指定实例是否在运行。 */
  isRunning(instanceId: string): boolean {
    return this.instances.get(instanceId)?.status === 'RUNNING';
  }

  // ── 内部工具 ──────────────────────────────────────────────────────────────

  /**
   * 构建实例启动命令：在模板命令中替换 --dir 参数，或追加。
   */
  private buildCommand(workDir: string): string[] {
    let template = [...this.opts.launchCommandTemplate];
    const dirIdx = template.indexOf('--dir');
    if (dirIdx >= 0 && dirIdx + 1 < template.length) {
      template[dirIdx + 1] = workDir;
    } else {
      template.push('--dir', workDir);
    }
    // Windows: spawn('npx', ...) 常报 ENOENT，改用 node_modules\.bin\tsx.cmd
    if (process.platform === 'win32' && template[0] === 'npx' && template[1] === 'tsx' && template[2]) {
      const scriptPath = template[2];
      const projectRoot = path.dirname(path.dirname(path.dirname(scriptPath)));
      const tsxCmd = path.join(projectRoot, 'node_modules', '.bin', 'tsx.cmd');
      if (fs.existsSync(tsxCmd)) {
        template = [tsxCmd, scriptPath, ...template.slice(3)];
      }
    }
    return template;
  }

  /**
   * 从 workDir 派生 tempDir（与内脑的 resolveIdentity 逻辑保持一致）。
   * 使用 deriveAgentId(workDir)，与内脑内部使用相同算法（MAC + 绝对路径 SHA-256）。
   */
  private deriveTempDir(workDir: string): string {
    const agentId = deriveAgentId(workDir);
    return path.join(globalTmpDir(), agentId);
  }

  /** 生成唯一实例 ID（时间戳 + 4 位随机串）。 */
  private generateId(): string {
    const ts   = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 6);
    return `ib-${ts}-${rand}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
