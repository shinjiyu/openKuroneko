/**
 * BrainFS — 管理 .brain/ 目录下的所有持久化文件
 *
 * 文件即真相（File-as-State）：内脑所有认知状态均存储于此。
 * 目录结构（均在 workDir/.brain/ 下）：
 *   goal.md              - 战略目标（外脑写）
 *   milestones.md        - 战术里程碑（Decomposer 写）
 *   constraints.md       - 归因红线（Attributor 追加）
 *   knowledge.md         - 环境事实（Attributor 追加）
 *   skills.md            - 可复用技能（Attributor 追加）
 *   environment.md       - 当前环境快照（框架更新）
 *   controller-state.json - 控制器状态机（框架读写）
 *   execution-context.json - EXECUTE→ATTRIBUTE 的临时传递（框架读写）
 */

import fs from 'node:fs';
import path from 'node:path';

// ── 里程碑解析 ────────────────────────────────────────────────────────────────

export interface Milestone {
  id: string;                            // e.g. "M1"
  status: 'Active' | 'Pending' | 'Completed';
  title: string;
  description: string;
}

// ── 控制器状态 ────────────────────────────────────────────────────────────────

export type ControllerMode = 'DECOMPOSE' | 'EXECUTE' | 'ATTRIBUTE' | 'BLOCKED';

export interface ControllerState {
  mode: ControllerMode;
  replanCount: number;
  replanReason: string | null;
  blockedReason: string | null;
}

// ── 执行上下文（EXECUTE → ATTRIBUTE 传递） ───────────────────────────────────

export interface ExecutionEntry {
  toolName: string;
  args: Record<string, unknown>;
  result: { ok: boolean; output: string };
  error?: string;
}

export interface ExecutionContext {
  activeMilestone: Milestone;
  preState: string;
  executionLog: ExecutionEntry[];
  postState: string;
}

// ── BrainFS 类 ────────────────────────────────────────────────────────────────

export class BrainFS {
  readonly brainDir: string;

  constructor(workDir: string) {
    this.brainDir = path.join(workDir, '.brain');
    fs.mkdirSync(this.brainDir, { recursive: true });
  }

  // ── 基础 I/O ────────────────────────────────────────────────────────────────

  private p(name: string): string {
    return path.join(this.brainDir, name);
  }

  private read(name: string): string {
    const fp = this.p(name);
    return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
  }

  private write(name: string, content: string): void {
    fs.writeFileSync(this.p(name), content, 'utf8');
  }

  private append(name: string, content: string): void {
    const fp = this.p(name);
    if (!fs.existsSync(fp)) {
      fs.writeFileSync(fp, content + '\n', 'utf8');
    } else {
      fs.appendFileSync(fp, '\n' + content + '\n', 'utf8');
    }
  }

  // ── 六大文件 ────────────────────────────────────────────────────────────────

  readGoal(): string      { return this.read('goal.md'); }
  writeGoal(c: string)    { this.write('goal.md', c); }

  readMilestones(): string       { return this.read('milestones.md'); }
  writeMilestones(c: string)     { this.write('milestones.md', c); }

  readConstraints(): string      { return this.read('constraints.md'); }
  appendConstraint(c: string)    { this.append('constraints.md', c); }

  readKnowledge(): string        { return this.read('knowledge.md'); }
  appendKnowledge(c: string)     { this.append('knowledge.md', c); }

  readSkills(): string           { return this.read('skills.md'); }
  appendSkill(c: string)         { this.append('skills.md', c); }

  readEnvironment(): string      { return this.read('environment.md'); }
  writeEnvironment(c: string)    { this.write('environment.md', c); }

  // ── 控制器状态 ───────────────────────────────────────────────────────────────

  readState(): ControllerState {
    try {
      const raw = this.read('controller-state.json');
      if (!raw.trim()) return defaultState();
      return JSON.parse(raw) as ControllerState;
    } catch {
      return defaultState();
    }
  }

  writeState(state: ControllerState): void {
    this.write('controller-state.json', JSON.stringify(state, null, 2));
  }

  // ── 执行上下文（临时，Attributor 读完即删） ────────────────────────────────

  hasExecutionContext(): boolean {
    return fs.existsSync(this.p('execution-context.json'));
  }

  readExecutionContext(): ExecutionContext | null {
    try {
      const raw = this.read('execution-context.json');
      if (!raw.trim()) return null;
      return JSON.parse(raw) as ExecutionContext;
    } catch {
      return null;
    }
  }

  writeExecutionContext(ctx: ExecutionContext): void {
    this.write('execution-context.json', JSON.stringify(ctx, null, 2));
  }

  clearExecutionContext(): void {
    const fp = this.p('execution-context.json');
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  // ── 里程碑解析 ───────────────────────────────────────────────────────────────

  parseMilestones(): Milestone[] {
    const content = this.readMilestones();
    const results: Milestone[] = [];
    for (const line of content.split('\n')) {
      const m = parseMilestoneLine(line);
      if (m) results.push(m);
    }
    return results;
  }

  getActiveMilestone(): Milestone | null {
    return this.parseMilestones().find(m => m.status === 'Active') ?? null;
  }

  markMilestoneCompleted(id: string): void {
    const content = this.readMilestones();
    // Replace [M1] [Active] → [M1] [Completed]
    const updated = content.replace(
      new RegExp(`(\\[${id}\\]\\s+)\\[Active\\]`, 'g'),
      `$1[Completed]`
    );
    this.writeMilestones(updated);
  }

  activateNextPending(): boolean {
    const milestones = this.parseMilestones();
    const next = milestones.find(m => m.status === 'Pending');
    if (!next) return false;
    const content = this.readMilestones();
    const updated = content.replace(
      new RegExp(`(\\[${next.id}\\]\\s+)\\[Pending\\]`),
      `$1[Active]  `
    );
    this.writeMilestones(updated);
    return true;
  }

  allMilestonesCompleted(): boolean {
    const milestones = this.parseMilestones();
    return milestones.length > 0 && milestones.every(m => m.status === 'Completed');
  }

  // ── goal.md 中读取 max_replan 参数 ──────────────────────────────────────────

  parseMaxReplan(): number {
    const goal = this.readGoal();
    const m = goal.match(/max_replan\s*[=:]\s*(\d+)/i);
    return m && m[1] ? parseInt(m[1], 10) : 5;
  }
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

function defaultState(): ControllerState {
  return { mode: 'DECOMPOSE', replanCount: 0, replanReason: null, blockedReason: null };
}

/** 解析单行里程碑，格式：[M1] [Active]  <title> — <desc> */
export function parseMilestoneLine(line: string): Milestone | null {
  // Accept em-dash, en-dash, or ` - ` as separator
  const m = line.match(
    /^\s*\[(\w+)\]\s+\[(Active|Pending|Completed)\]\s+(.+?)\s+[—–-]\s+(.+)\s*$/u
  );
  if (!m || !m[1] || !m[2] || !m[3] || !m[4]) return null;
  return {
    id: m[1],
    status: m[2] as 'Active' | 'Pending' | 'Completed',
    title: m[3].trim(),
    description: m[4].trim(),
  };
}
