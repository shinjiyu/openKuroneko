/**
 * Pi-mono 演化循环控制器
 *
 * 在三种思维模式之间切换：
 *   DECOMPOSE  → 战术拆解（Decomposer）
 *   EXECUTE    → 反应执行（Executor）
 *   ATTRIBUTE  → 强制归因（Attributor）
 *   BLOCKED    → 等待外脑介入
 *
 * 每次 tick() 执行一个完整阶段，返回 hadWork 供调度器决定退避。
 */

import fs from 'node:fs';
import path from 'node:path';

import type { LLMAdapter } from '../adapter/index.js';
import type { IORegistry } from '../io/index.js';
import type { ToolRegistry } from '../tools/index.js';
import type { MemoryLayer2 } from '../memory/index.js';
import type { Mem0Client } from '../mem0/index.js';
import type { Logger } from '../logger/index.js';
import { BrainFS } from '../brain/index.js';
import type { Milestone } from '../brain/index.js';
import { runDecomposer } from './decomposer.js';
import { runExecutor } from './executor.js';
import { runAttributor } from './attributor.js';
import { resolveBlock } from './block-resolver.js';
import { captureSnapshot } from './snapshot.js';
import type { KnowledgeStore } from '../archive/index.js';

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface ControllerContext {
  agentId: string;
  workDir: string;
  tempDir: string;
}

export interface ControllerDeps {
  llm: LLMAdapter;
  ioRegistry: IORegistry;
  /** Executor 使用的全套工具 */
  executorToolRegistry: ToolRegistry;
  /** Attributor 使用的专用工具（write_constraint / write_skill / write_knowledge） */
  attributorToolRegistry: ToolRegistry;
  memory: MemoryLayer2;
  mem0: Mem0Client;
  logger: Logger;
  /** 知识归档与复用（可选；未提供时跳过归档） */
  knowledgeStore?: KnowledgeStore;
}

export interface TickResult {
  hadWork: boolean;
}

export interface Controller {
  tick(): Promise<TickResult>;
}

// ── 工厂函数 ──────────────────────────────────────────────────────────────────

export function createController(ctx: ControllerContext, deps: ControllerDeps): Controller {
  const { agentId, workDir, tempDir } = ctx;
  const { llm, ioRegistry, executorToolRegistry, attributorToolRegistry, memory, mem0, logger, knowledgeStore } = deps;

  const brain          = new BrainFS(workDir);
  const statusFile     = path.join(tempDir, 'status');
  const directivesFile = path.join(tempDir, 'directives');

  function syncStatus(): void {
    try {
      const state     = brain.readState();
      const milestone = brain.getActiveMilestone();
      const status: Record<string, unknown> = {
        ts:               new Date().toISOString(),
        mode:             state.mode,
        milestone:        milestone ? { id: milestone.id, title: milestone.title, cyclic: milestone.cyclic ?? false } : null,
        goal_origin_user: brain.readGoalOriginUser(),
        blocked:          state.mode === 'BLOCKED',
        block_reason:     state.blockedReason ?? null,
      };
      if (state.mode === 'SLEEPING') {
        status['sleeping_until'] = state.sleepUntil ?? null;
        status['cycle_count']    = state.cycleCount ?? 0;
      }
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2), 'utf8');
    } catch { /* non-critical */ }
  }

  return {
    async tick(): Promise<TickResult> {
      const state = brain.readState();

      // 每轮开始时同步状态供外脑读取
      syncStatus();

      logger.info('controller', {
        event: 'tick.start',
        data: { mode: state.mode, replanCount: state.replanCount },
      });

      // ── BLOCKED 状态：等待外脑 input 或 directives ───────────────────────────
      if (state.mode === 'BLOCKED') {
        // 优先读 input（[NEW_GOAL] 指令或外脑直接指令）
        const input = await safeReadInput(ioRegistry, logger);

        // 同时读取 directives（BLOCK 解封回复、约束补充）
        const directives = readAndClearDirectives(directivesFile, logger);
        const blockResolutionDirective = directives.find(
          d => d.type === 'feedback' && d.content.startsWith('[BLOCK解封]'),
        );

        // 如果 input 和 directives 都没有内容，继续等待
        if (!input && !blockResolutionDirective) {
          return { hadWork: false };
        }

        // [NEW_GOAL] 指令或"目标已完成"后的新任务 → 归档旧 brain，重新规划
        // 注意：[NEW_GOAL] 必须优先于 LLM 解封，否则 goal.md 缺失时 REPLAN 路径不写 goal 会死循环
        const isPostComplete = state.blockedReason === '目标已完成，等待新目标';
        const isNewGoalCmd   = !!input?.trimStart().startsWith('[NEW_GOAL]');
        if (input && (isPostComplete || isNewGoalCmd)) {
          brain.archiveForNewTask();
          logger.info('controller', { event: 'brain.archived.for.new.task', data: { preview: input.slice(0, 80) } });
          brain.writeGoal(input);
          state.replanReason = isNewGoalCmd ? `新任务指令：${input.slice(0, 100)}` : `新任务：${input.slice(0, 100)}`;
          state.mode = 'DECOMPOSE';
          state.replanCount = 0;
          state.blockedReason = null;
          brain.writeState(state);
          logger.info('controller', { event: 'new.task.from.input', data: { preview: input.slice(0, 80) } });
          return { hadWork: true };
        }

        // 非新任务 input 或来自 directives 的 BLOCK 解封回复
        // 优先使用 input，其次用 BLOCK 解封 directive
        const resolveContent = input ?? (blockResolutionDirective
          ? blockResolutionDirective.content.replace('[BLOCK解封] 用户回复：', '')
          : '');

        if (!resolveContent) return { hadWork: false };

        // 将 directives 中的约束注入 constraints.md（feedback 类不注入）
        for (const d of directives) {
          if (d.type === 'constraint' || d.type === 'requirement') {
            const note = `\n\n<!-- directive ${d.type} ${d.ts} from ${d.from} -->\n[外脑指示] ${d.content}`;
            brain.appendConstraint(note);
            logger.info('controller', { event: 'directive.applied', data: { type: d.type, preview: d.content.slice(0, 60) } });
          }
        }

        // 方案 C：LLM 判断 CONTINUE vs REPLAN（仅用于真实 BLOCK，非新目标指令）
        const decision = await resolveBlock(state.blockedReason ?? '', resolveContent, llm, logger);

        const humanNote = `\n\n<!-- 外脑解封指令 ${new Date().toISOString()} -->\n[人类指示] ${resolveContent}`;
        brain.appendConstraint(humanNote);
        logger.info('controller', { event: 'block.human.note.written', data: { preview: resolveContent.slice(0, 80) } });

        // 解封后无论走哪条路径都重置 replanCount，
        // 防止因"连续 REPLAN 超限→BLOCKED→解封→立即再 REPLAN 超限"形成死锁。
        state.replanCount = 0;
        if (decision === 'CONTINUE') {
          state.mode = 'EXECUTE';
          state.blockedReason = null;
        } else {
          state.replanReason = `BLOCK 已解除，外脑指示：${resolveContent}`;
          state.mode = 'DECOMPOSE';
          state.blockedReason = null;
        }
        brain.writeState(state);
        return { hadWork: true };
      }

      // ── DECOMPOSE 状态 ────────────────────────────────────────────────────────
      if (state.mode === 'DECOMPOSE') {
        const goal = brain.readGoal();
        if (!goal.trim()) {
          logger.error('controller', { event: 'goal.missing', data: {} });
          await writeBlockOutput(ioRegistry, '.brain/goal.md 不存在或为空，无法启动内脑。请通过 --goal 或 --goal-file 参数指定目标。', null, logger);
          state.mode = 'BLOCKED';
          state.blockedReason = 'goal.md 缺失';
          brain.writeState(state);
          return { hadWork: true };
        }

        const result = await runDecomposer(brain, state.replanReason, llm, logger, knowledgeStore);

        if (!result.ok) {
          logger.error('controller', { event: 'decompose.failed', data: { error: result.error } });
          await writeBlockOutput(ioRegistry, `Decomposer 无法生成有效里程碑：${result.error}`, brain.readGoalOriginUser(), logger);
          state.mode = 'BLOCKED';
          state.blockedReason = `Decomposer 失败：${result.error}`;
          brain.writeState(state);
          return { hadWork: true };
        }

        brain.writeMilestones(result.milestonesContent);
        state.mode = 'EXECUTE';
        state.replanReason = null;
        brain.writeState(state);

        logger.info('controller', { event: 'decompose.done', data: { milestones: result.milestonesContent.slice(0, 200) } });
        return { hadWork: true };
      }

      // ── EXECUTE 状态 ──────────────────────────────────────────────────────────
      if (state.mode === 'EXECUTE') {
        // 检查是否有外脑 input（外脑干预 → REPLAN）
        const input = await safeReadInput(ioRegistry, logger);
        if (input) {
          logger.info('controller', { event: 'external.intervention', data: { preview: input.slice(0, 80) } });
          state.replanReason = `外脑干预：${input}`;
          state.mode = 'DECOMPOSE';
          brain.writeState(state);
          return { hadWork: true };
        }

        // 消费 directives（约束/需求 → 注入 constraints.md；feedback 仅记录）
        const execDirectives = readAndClearDirectives(directivesFile, logger);
        for (const d of execDirectives) {
          if (d.type === 'constraint' || d.type === 'requirement') {
            const note = `\n\n<!-- directive ${d.type} ${d.ts} from ${d.from} -->\n[外脑指示] ${d.content}`;
            brain.appendConstraint(note);
            logger.info('controller', { event: 'directive.applied', data: { type: d.type, preview: d.content.slice(0, 60) } });
          } else {
            logger.info('controller', { event: 'directive.feedback', data: { from: d.from, preview: d.content.slice(0, 60) } });
          }
        }

        const activeMilestone = brain.getActiveMilestone((badLine) => {
          logger.warn('controller', { event: 'milestone.parse.failed', data: { line: badLine.slice(0, 120) } });
        });
        if (!activeMilestone) {
          // 没有 Active 里程碑，检查是否全部完成
          if (brain.allMilestonesCompleted()) {
            await handleAllCompleted(brain, ioRegistry, memory, mem0, agentId, logger, knowledgeStore, workDir);
          } else {
            // 里程碑为空 → 重新规划
            state.replanReason = '没有 Active 里程碑，需要重新规划';
            state.mode = 'DECOMPOSE';
            brain.writeState(state);
          }
          return { hadWork: true };
        }

        // 执行前快照
        const preState = captureSnapshot(workDir);
        brain.writeEnvironment(preState);

        const execResult = await runExecutor(
          brain,
          activeMilestone,
          workDir,
          executorToolRegistry,
          llm,
          logger,
        );

        // 执行后快照（executor 内已更新 environment.md）
        const postState = brain.readEnvironment();

        // 保存 execution context，切换到 ATTRIBUTE
        brain.writeExecutionContext({
          activeMilestone,
          preState,
          executionLog: execResult.executionLog,
          postState,
        });

        state.mode = 'ATTRIBUTE';
        brain.writeState(state);

        return { hadWork: true };
      }

      // ── ATTRIBUTE 状态 ────────────────────────────────────────────────────────
      if (state.mode === 'ATTRIBUTE') {
        const execCtx = brain.readExecutionContext();
        if (!execCtx) {
          // 没有执行上下文（可能是重启后遗留），回退到 EXECUTE
          logger.warn('controller', { event: 'attribute.no.context', data: {} });
          state.mode = 'EXECUTE';
          brain.writeState(state);
          return { hadWork: true };
        }

        const attrResult = await runAttributor(
          execCtx.activeMilestone,
          execCtx.preState,
          execCtx.executionLog,
          execCtx.postState,
          attributorToolRegistry,
          llm,
          logger,
          brain,
        );

        // 归因完成 → 丢弃 executionLog
        brain.clearExecutionContext();

        // 将执行摘要存入 Daily Log + mem0（"存入记忆以防万一"）
        const summary = buildExecutionSummary(execCtx.activeMilestone, execCtx.executionLog, attrResult.flag, attrResult.reason);
        memory.appendDailyLog(summary);
        await safeMem0Add(mem0, summary, agentId, logger);

        // 根据 Control Flag 更新状态
        const maxReplan = brain.parseMaxReplan();

        switch (attrResult.flag) {
          case 'CONTINUE':
            state.mode = 'EXECUTE';
            brain.writeState(state);
            break;

          case 'SUCCESS_AND_NEXT': {
            brain.markMilestoneCompleted(execCtx.activeMilestone.id);
            const hasNext = brain.activateNextPending();
            if (hasNext) {
              state.mode = 'EXECUTE';
              brain.writeState(state);
              logger.info('controller', { event: 'milestone.next', data: { completedId: execCtx.activeMilestone.id } });
            } else {
              await handleAllCompleted(brain, ioRegistry, memory, mem0, agentId, logger, knowledgeStore, workDir);
            }
            break;
          }

          case 'REPLAN': {
            state.replanCount += 1;
            if (state.replanCount > maxReplan) {
              // 连续 REPLAN 超限 → 升级为 BLOCK
              const replanReason = `已连续 REPLAN ${state.replanCount} 次（上限 ${maxReplan}），无法自主突破。最后原因：${attrResult.reason}`;
              await writeBlockOutput(ioRegistry, replanReason, brain.readGoalOriginUser(), logger);
              state.mode = 'BLOCKED';
              state.blockedReason = `连续 REPLAN 超限：${attrResult.reason}`;
              brain.writeState(state);
              await safeArchive(knowledgeStore, brain, agentId, workDir, 'REPLAN_LIMIT', attrResult.reason, logger);
            } else {
              state.replanReason = attrResult.reason;
              state.mode = 'DECOMPOSE';
              brain.writeState(state);
              logger.info('controller', { event: 'replan', data: { count: state.replanCount, reason: attrResult.reason } });
            }
            break;
          }

          case 'BLOCK': {
            const goalOriginUser = brain.readGoalOriginUser();
            await writeBlockOutput(ioRegistry, attrResult.reason, goalOriginUser, logger);
            state.mode = 'BLOCKED';
            state.blockedReason = attrResult.reason;
            state.replanCount = 0; // 重置计数，外脑介入后重新开始
            brain.writeState(state);
            logger.info('controller', { event: 'blocked', data: { reason: attrResult.reason } });
            await safeArchive(knowledgeStore, brain, agentId, workDir, 'BLOCK', attrResult.reason, logger);
            break;
          }

          case 'CYCLE_DONE': {
            const milestone = execCtx.activeMilestone;
            if (!milestone.cyclic || !milestone.cycleIntervalMs) {
              // 非循环里程碑误用 CYCLE_DONE → 降级为 CONTINUE，记录警告
              logger.warn('controller', {
                event: 'cycle_done.non_cyclic',
                data: { milestoneId: milestone.id, reason: attrResult.reason },
              });
              state.mode = 'EXECUTE';
              brain.writeState(state);
              break;
            }

            // cyclic:0 防护：间隔为 0 会造成无限紧密循环，强制最小 1 分钟
            const safeInterval = Math.max(milestone.cycleIntervalMs, 60_000);
            if (safeInterval !== milestone.cycleIntervalMs) {
              logger.warn('controller', {
                event: 'cycle_done.interval_clamped',
                data: { milestoneId: milestone.id, original: milestone.cycleIntervalMs, clamped: safeInterval },
              });
            }

            // max_cycles 保护（goal.md 可声明 max_cycles: N）
            const maxCycles  = brain.parseMaxCycles();
            const newCycleCount = (state.cycleCount ?? 0) + 1;
            if (maxCycles > 0 && newCycleCount > maxCycles) {
              logger.warn('controller', {
                event: 'cycle_done.max_cycles_exceeded',
                data: { milestoneId: milestone.id, cycleCount: newCycleCount, maxCycles },
              });
              // 超出最大轮次 → 强制进入 BLOCKED，等待人工决策
              const reason = `循环里程碑 ${milestone.id} 已执行 ${newCycleCount} 轮（max_cycles=${maxCycles}），超出上限，等待外脑决策。`;
              await writeBlockOutput(ioRegistry, reason, brain.readGoalOriginUser(), logger);
              state.mode         = 'BLOCKED';
              state.blockedReason = reason;
              state.cycleCount    = newCycleCount;
              brain.writeState(state);
              break;
            }

            // 循环里程碑：本轮完成，进入 SLEEPING 等待下一周期
            brain.keepCyclicMilestoneActive(milestone.id);
            state.cycleCount  = newCycleCount;
            state.sleepUntil  = new Date(Date.now() + safeInterval).toISOString();
            state.mode        = 'SLEEPING';
            state.replanCount = 0;
            brain.writeState(state);

            logger.info('controller', {
              event: 'cycle.sleeping',
              data: {
                milestoneId:   milestone.id,
                cycleCount:    state.cycleCount,
                sleepUntil:    state.sleepUntil,
                intervalMs:    milestone.cycleIntervalMs,
                reason:        attrResult.reason,
              },
            });

            // 通知外脑（PROGRESS，不打断用户）
            await writeProgressOutput(
              ioRegistry,
              `[循环第 ${state.cycleCount} 轮完成] ${attrResult.reason}\n下一轮时间：${state.sleepUntil}`,
              brain.readGoalOriginUser(),
              logger,
            );
            break;
          }
        }

        return { hadWork: true };
      }

      // ── SLEEPING 状态：等待定时唤醒（循环里程碑间歇） ──────────────────────────
      if (state.mode === 'SLEEPING') {
        // 外脑 input / directives 始终可以提前唤醒
        const input = await safeReadInput(ioRegistry, logger);
        const directives = readAndClearDirectives(directivesFile, logger);
        const hasExternalSignal = !!input || directives.length > 0;

        const wakeTime = state.sleepUntil ? new Date(state.sleepUntil).getTime() : 0;
        const shouldWake = hasExternalSignal || Date.now() >= wakeTime;

        if (!shouldWake) {
          return { hadWork: false };
        }

        // 唤醒：注入外脑信号（如果有），恢复 EXECUTE
        if (input) {
          logger.info('controller', { event: 'sleep.interrupted', data: { reason: 'external input', preview: input.slice(0, 80) } });
          state.replanReason = `外脑干预唤醒：${input}`;
          state.mode = 'DECOMPOSE';
        } else {
          logger.info('controller', {
            event: 'sleep.wakeup',
            data: { cycleCount: state.cycleCount ?? 0, sleepUntil: state.sleepUntil },
          });
          // 注入约束（如有 directive）
          for (const d of directives) {
            if (d.type === 'constraint' || d.type === 'requirement') {
              brain.appendConstraint(
                `\n\n<!-- directive ${d.type} ${d.ts} from ${d.from} -->\n[外脑指示] ${d.content}`,
              );
            }
          }
          state.mode = 'EXECUTE';
        }
        state.sleepUntil = null;
        brain.writeState(state);
        return { hadWork: true };
      }

      // 不应到达这里
      logger.error('controller', { event: 'unknown.mode', data: { mode: state.mode } });
      return { hadWork: false };
    },
  };
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

async function handleAllCompleted(
  brain: BrainFS,
  ioRegistry: IORegistry,
  memory: MemoryLayer2,
  mem0: Mem0Client,
  agentId: string,
  logger: Logger,
  knowledgeStore?: KnowledgeStore,
  workDir?: string,
): Promise<void> {
  const goal = brain.readGoal();
  const milestones = brain.readMilestones();
  const goalOriginUser = brain.readGoalOriginUser();

  const reportText = [
    `所有里程碑已完成。`,
    ``,
    `## 最终目标`,
    goal,
    ``,
    `## 完成的里程碑`,
    milestones,
  ].join('\n');

  await writeCompleteOutput(ioRegistry, reportText, goalOriginUser, logger);
  memory.appendDailyLog(`[完成] 目标达成，输出报告`);
  await safeMem0Add(mem0, `目标已完成: ${goal.slice(0, 200)}`, agentId, logger);

  // 进入 BLOCKED 状态等待新 goal（不清除 goal.md，保留历史记录）
  // 注意：blockedReason 字符串必须与 controller BLOCKED 处理器中的 isPostComplete 判断一致
  brain.writeState({ mode: 'BLOCKED', replanCount: 0, replanReason: null, blockedReason: '目标已完成，等待新目标' });
  logger.info('controller', { event: 'all.complete', data: {} });

  await safeArchive(knowledgeStore, brain, agentId, workDir ?? '', 'COMPLETE', '目标全部完成', logger);
}

function buildExecutionSummary(
  milestone: Milestone,
  log: import('../brain/index.js').ExecutionEntry[],
  flag: string,
  reason: string,
): string {
  const toolNames = [...new Set(log.map(e => e.toolName))].join(', ') || '（无工具调用）';
  const errCount  = log.filter(e => !e.result.ok || e.error).length;
  return [
    `[执行归因] 里程碑: ${milestone.id} — ${milestone.title}`,
    `  工具: ${toolNames}  错误: ${errCount}/${log.length}`,
    `  结论: ${flag} — ${reason}`,
  ].join('\n');
}

async function safeReadInput(ioRegistry: IORegistry, logger: Logger): Promise<string | null> {
  try {
    const ep = ioRegistry.getInput('default');
    if (!ep) return null;
    const content = await ep.read();
    if (content) {
      logger.info('io', { event: 'input.read', data: { preview: content.slice(0, 80) } });
    }
    return content;
  } catch (e) {
    logger.error('io', { event: 'input.read.error', data: { error: String(e) } });
    return null;
  }
}

async function writeOutput(ioRegistry: IORegistry, content: string, logger: Logger): Promise<void> {
  try {
    const ep = ioRegistry.getOutput('default');
    if (!ep) return;
    await ep.write(content);
    logger.info('io', { event: 'output.write', data: { preview: content.slice(0, 100) } });
  } catch (e) {
    logger.error('io', { event: 'output.write.error', data: { error: String(e) } });
  }
}

/**
 * 写入结构化 BLOCK 输出（JSON），供外脑 push-loop 解析。
 * 向后兼容：同时写纯文本前缀（[BLOCK]）。
 */
async function writeBlockOutput(
  ioRegistry: IORegistry,
  reason: string,
  targetUser: string | null,
  logger: Logger,
): Promise<void> {
  const output = JSON.stringify({
    type:        'BLOCK',
    message:     reason,
    question:    reason,
    target_user: targetUser ?? undefined,
    ts:          new Date().toISOString(),
  });
  await writeOutput(ioRegistry, output, logger);
}

/**
 * 写入 PROGRESS 输出（JSON），供外脑 push-loop 记录进度（不打断用户）。
 */
async function writeProgressOutput(
  ioRegistry: IORegistry,
  message: string,
  targetUser: string | null,
  logger: Logger,
): Promise<void> {
  const output = JSON.stringify({
    type:        'PROGRESS',
    message,
    target_user: targetUser ?? undefined,
    ts:          new Date().toISOString(),
  });
  await writeOutput(ioRegistry, output, logger);
}

/**
 * 写入结构化 COMPLETE 输出（JSON），供外脑 push-loop 解析。
 */
async function writeCompleteOutput(
  ioRegistry: IORegistry,
  message: string,
  targetUser: string | null,
  logger: Logger,
): Promise<void> {
  const output = JSON.stringify({
    type:        'COMPLETE',
    message,
    target_user: targetUser ?? undefined,
    ts:          new Date().toISOString(),
  });
  await writeOutput(ioRegistry, output, logger);
}

async function safeArchive(
  store: KnowledgeStore | undefined,
  brain: BrainFS,
  agentId: string,
  workDir: string,
  trigger: import('../archive/index.js').ArchiveTrigger,
  triggerReason: string,
  logger: Logger,
): Promise<void> {
  if (!store) return;
  try {
    await store.archive({ brain, agentId, workDir, trigger, triggerReason, goalText: brain.readGoal() });
    logger.info('archive', { event: 'archive.done', data: { trigger, agentId } });
  } catch (e) {
    logger.warn('archive', { event: 'archive.error', data: { error: String(e) } });
  }
}

// ── directives 文件工具 ───────────────────────────────────────────────────────

interface Directive {
  ts:      string;
  type:    'constraint' | 'requirement' | 'feedback';
  content: string;
  from:    string;
}

/**
 * 读取并清空 directives 文件。
 * 返回解析成功的所有 directive 条目（失败的行跳过）。
 */
function readAndClearDirectives(filePath: string, logger: Logger): Directive[] {
  if (!fs.existsSync(filePath)) return [];
  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
    fs.writeFileSync(filePath, '', 'utf8'); // 消费后立即清空
  } catch (e) {
    logger.warn('controller', { event: 'directives.read.error', data: { error: String(e) } });
    return [];
  }

  const results: Directive[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const d = JSON.parse(trimmed) as Directive;
      if (d.type && d.content) {
        results.push(d);
        logger.info('controller', { event: 'directive.consumed', data: { type: d.type, from: d.from, preview: d.content.slice(0, 60) } });
      }
    } catch {
      logger.warn('controller', { event: 'directive.parse.error', data: { line: trimmed.slice(0, 80) } });
    }
  }
  return results;
}

async function safeMem0Add(
  mem0: Mem0Client,
  content: string,
  agentId: string,
  logger: Logger,
): Promise<void> {
  try {
    await mem0.add(content, agentId);
    logger.debug('mem0', { event: 'add', data: { len: content.length } });
  } catch (e) {
    logger.warn('mem0', { event: 'add.error', data: { error: String(e) } });
  }
}
