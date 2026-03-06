/**
 * 模式 B — 反应执行器（Reactive Executor）
 *
 * 每次从 .brain/ 文件全新重建上下文（无历史感知）。
 * 运行多轮工具调用直到 LLM 停止返回 tool calls。
 * 结束后写入 execution-context.json 供 Attributor 使用。
 */

import type { Message, LLMAdapter } from '../adapter/index.js';
import type { Logger } from '../logger/index.js';
import type { ToolRegistry } from '../tools/index.js';
import type { BrainFS, Milestone, ExecutionEntry } from '../brain/index.js';
import { captureSnapshot } from './snapshot.js';

export const EXECUTOR_SYSTEM = `你是一个反应执行器（Reactive Executor）。你的唯一职责是：
专注完成当前 Active 里程碑，通过工具调用推进目标。

执行规则：
- 只做「当前 Active 里程碑」要求的事，不碰其他里程碑
- 严格遵守 Constraints 里的所有约束，红线绝对不可越
- 优先参考 Skills 里已有的成功操作模式，避免重复探索
- 文件路径使用相对路径（相对于工作目录）
- 不要直接修改 .brain/ 目录下的文件（由框架管理）
- 当你认为本次执行循环做得差不多了，停止调用工具
- 归因由框架强制执行，你不需要自我评估是否完成`;

export interface ExecutorResult {
  executionLog: ExecutionEntry[];
  lastContent: string;
  error?: string;
}

export async function runExecutor(
  brain: BrainFS,
  activeMilestone: Milestone,
  workDir: string,
  toolRegistry: ToolRegistry,
  llm: LLMAdapter,
  logger: Logger,
): Promise<ExecutorResult> {
  const constraints  = brain.readConstraints()  || '暂无约束';
  const environment  = brain.readEnvironment()  || '暂无环境信息';
  const knowledge    = brain.readKnowledge()    || '暂无已知事实';
  const skills       = brain.readSkills()       || '暂无已积累技能';

  const milestoneText = `[${activeMilestone.id}] [Active] ${activeMilestone.title} — ${activeMilestone.description}`;

  const userMessage = [
    `## 当前任务（Active Milestone）\n${milestoneText}`,
    `## 约束（必须严格遵守）\n${constraints}`,
    `## 当前环境\n${environment}`,
    `## 知识库（环境事实）\n${knowledge}`,
    `## 技能库（可复用操作模式）\n${skills}`,
    `## 工作目录\n${workDir}\n\n请使用工具对当前里程碑执行操作。`,
  ].join('\n\n---\n\n');

  logger.info('executor', {
    event: 'execute.start',
    data: { milestoneId: activeMilestone.id, title: activeMilestone.title },
  });

  const executionLog: ExecutionEntry[] = [];
  let currentMessages: Message[] = [{ role: 'user', content: userMessage }];
  let lastContent = '';

  for (let round = 0; ; round++) {
    logger.info('executor', { event: 'llm.call', data: { round } });

    let result;
    try {
      result = await llm.chat(EXECUTOR_SYSTEM, currentMessages, toolRegistry.schema());
    } catch (e) {
      const errMsg = String(e);
      logger.error('executor', { event: 'llm.error', data: { round, error: errMsg } });
      executionLog.push({
        toolName: '__llm_error__',
        args: {},
        result: { ok: false, output: errMsg },
        error: errMsg,
      });
      break;
    }

    lastContent = result.content ?? '';

    if (!result.toolCalls || result.toolCalls.length === 0) {
      logger.info('executor', { event: 'llm.done', data: { round, contentLen: lastContent.length } });
      break;
    }

    const assistantMsg: Message = { role: 'assistant', content: lastContent };
    const toolResultMsgs: Message[] = [assistantMsg];

    for (const tc of result.toolCalls) {
      const tool = toolRegistry.get(tc.name);

      if (!tool) {
        logger.warn('executor', { event: 'tool.unknown', data: { name: tc.name } });
        const entry: ExecutionEntry = {
          toolName: tc.name,
          args: tc.args,
          result: { ok: false, output: `Unknown tool: ${tc.name}` },
        };
        executionLog.push(entry);
        toolResultMsgs.push({
          role: 'tool',
          content: JSON.stringify({ ok: false, output: `Unknown tool: ${tc.name}` }),
        });
        continue;
      }

      logger.info('executor', {
        event: 'tool.call',
        data: { name: tc.name, args: redactArgs(tc.args) },
      });

      let toolResult: { ok: boolean; output: string };
      try {
        toolResult = await tool.call(tc.args);
      } catch (e) {
        toolResult = { ok: false, output: String(e) };
      }

      logger.info('executor', {
        event: 'tool.result',
        data: { name: tc.name, ok: toolResult.ok, preview: toolResult.output.slice(0, 120) },
      });

      const entry: ExecutionEntry = { toolName: tc.name, args: tc.args, result: toolResult };
      executionLog.push(entry);

      toolResultMsgs.push({
        role: 'tool',
        content: JSON.stringify({ ok: toolResult.ok, output: toolResult.output }),
      });
    }

    currentMessages = [...currentMessages, ...toolResultMsgs];
  }

  logger.info('executor', {
    event: 'execute.done',
    data: { milestoneId: activeMilestone.id, toolCalls: executionLog.length },
  });

  // 更新 environment.md（执行后快照）
  try {
    const postSnap = captureSnapshot(workDir);
    brain.writeEnvironment(postSnap);
  } catch {
    // 快照失败不影响主流程
  }

  return { executionLog, lastContent };
}

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && v.length > 200) out[k] = v.slice(0, 200) + '…';
    else out[k] = v;
  }
  return out;
}
