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
  const { agentId, workDir } = ctx;
  const { llm, ioRegistry, executorToolRegistry, attributorToolRegistry, memory, mem0, logger, knowledgeStore } = deps;

  const brain = new BrainFS(workDir);

  return {
    async tick(): Promise<TickResult> {
      const state = brain.readState();

      logger.info('controller', {
        event: 'tick.start',
        data: { mode: state.mode, replanCount: state.replanCount },
      });

      // ── BLOCKED 状态：等待外脑 input ─────────────────────────────────────────
      if (state.mode === 'BLOCKED') {
        const input = await safeReadInput(ioRegistry, logger);
        if (!input) {
          return { hadWork: false }; // 继续等待，调度器退避
        }

        // 如果是"目标完成"后的 BLOCKED，input 视为新的外脑指示 → 直接 REPLAN（重新规划）
        const isPostComplete = state.blockedReason === '目标完成，等待新目标';
        if (isPostComplete) {
          // 将 input 追加到 goal.md 作为新目标说明
          const oldGoal = brain.readGoal();
          brain.writeGoal(`${oldGoal}\n\n---\n## 新指示\n${input}`);
          state.replanReason = `收到新指示：${input.slice(0, 100)}`;
          state.mode = 'DECOMPOSE';
          state.replanCount = 0;
          state.blockedReason = null;
          brain.writeState(state);
          logger.info('controller', { event: 'new.goal.from.input', data: { preview: input.slice(0, 80) } });
          return { hadWork: true };
        }

        // 方案 C：LLM 判断 CONTINUE vs REPLAN
        const decision = await resolveBlock(state.blockedReason ?? '', input, llm, logger);
        if (decision === 'CONTINUE') {
          state.mode = 'EXECUTE';
          state.blockedReason = null;
        } else {
          state.replanReason = `BLOCK 已解除，外脑指示：${input}`;
          state.mode = 'DECOMPOSE';
        }
        brain.writeState(state);
        return { hadWork: true };
      }

      // ── DECOMPOSE 状态 ────────────────────────────────────────────────────────
      if (state.mode === 'DECOMPOSE') {
        const goal = brain.readGoal();
        if (!goal.trim()) {
          logger.error('controller', { event: 'goal.missing', data: {} });
          await writeOutput(ioRegistry, '[BLOCK] .brain/goal.md 不存在或为空，无法启动内脑。请通过 --goal 或 --goal-file 参数指定目标。', logger);
          state.mode = 'BLOCKED';
          state.blockedReason = 'goal.md 缺失';
          brain.writeState(state);
          return { hadWork: true };
        }

        const result = await runDecomposer(brain, state.replanReason, llm, logger, knowledgeStore);

        if (!result.ok) {
          // Decomposer 失败两次 → BLOCK
          logger.error('controller', { event: 'decompose.failed', data: { error: result.error } });
          await writeOutput(ioRegistry, `[BLOCK] Decomposer 无法生成有效里程碑：${result.error}`, logger);
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

        const activeMilestone = brain.getActiveMilestone();
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
              // 所有里程碑完成
              await handleAllCompleted(brain, ioRegistry, memory, mem0, agentId, logger, knowledgeStore, workDir);
            }
            break;
          }

          case 'REPLAN': {
            state.replanCount += 1;
            if (state.replanCount > maxReplan) {
              // 连续 REPLAN 超限 → 升级为 BLOCK
              const blockMsg = `[BLOCK] 已连续 REPLAN ${state.replanCount} 次（上限 ${maxReplan}），无法自主突破。最后原因：${attrResult.reason}`;
              await writeOutput(ioRegistry, blockMsg, logger);
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
            const blockMsg = `[BLOCK] ${attrResult.reason}`;
            await writeOutput(ioRegistry, blockMsg, logger);
            state.mode = 'BLOCKED';
            state.blockedReason = attrResult.reason;
            state.replanCount = 0; // 重置计数，外脑介入后重新开始
            brain.writeState(state);
            logger.info('controller', { event: 'blocked', data: { reason: attrResult.reason } });
            await safeArchive(knowledgeStore, brain, agentId, workDir, 'BLOCK', attrResult.reason, logger);
            break;
          }
        }

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
  const report = [
    `[COMPLETE] 所有里程碑已完成。`,
    ``,
    `## 最终目标`,
    goal,
    ``,
    `## 完成的里程碑`,
    milestones,
  ].join('\n');

  await writeOutput(ioRegistry, report, logger);
  memory.appendDailyLog(`[完成] 目标达成，输出报告`);
  await safeMem0Add(mem0, `目标已完成: ${goal.slice(0, 200)}`, agentId, logger);

  // 进入 BLOCKED 状态等待新 goal（不清除 goal.md，保留历史记录）
  // 不重置为 DECOMPOSE，否则下个 tick 会用同一 goal 重新开始
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
