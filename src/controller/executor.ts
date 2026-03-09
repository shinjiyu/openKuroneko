/**
 * 模式 B — 反应执行器（Reactive Executor）
 *
 * 每次从 .brain/ 文件全新重建上下文（无历史感知）。
 * 运行多轮工具调用直到 LLM 停止返回 tool calls。
 * 结束后写入 execution-context.json 供 Attributor 使用。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Message, LLMAdapter } from '../adapter/index.js';
import type { Logger } from '../logger/index.js';
import type { ToolRegistry } from '../tools/index.js';
import { BrainFS, type Milestone, type ExecutionEntry } from '../brain/index.js';
import { captureSnapshot } from './snapshot.js';

// Executor 读取 brain 文件时的字符上限（取最近内容，防止历史噪音淹没指令）
const KNOWLEDGE_MAX    = 5000;
const CONSTRAINTS_MAX  = 4000;
const ENVIRONMENT_MAX  = 3000;
/** 动态发现技能时最多注入的条目数 */
const SKILLS_TOP_K     = 4;
/** 单条技能文件内容最大字符数（过长则截断） */
const SKILL_FILE_MAX   = 1200;

/**
 * 工具输出压缩阈值（字符数）。
 * 超过此阈值的 output：完整内容写入 .tool-outputs/ 文件，
 * LLM messages 里只放头尾摘要 + 文件路径引用。
 */
const TOOL_OUTPUT_INLINE_MAX = 3000;
/** 摘要头部保留字符数 */
const TOOL_OUTPUT_HEAD = 1500;
/** 摘要尾部保留字符数 */
const TOOL_OUTPUT_TAIL = 1000;

let _outputSeq = 0;

/**
 * 如果 output 超过阈值，将完整内容存到 workDir/.tool-outputs/<seq>-<toolName>.txt，
 * 返回带文件路径引用的摘要字符串。否则原样返回。
 */
function compressToolOutput(
  toolName: string,
  output: string,
  workDir: string,
): string {
  if (output.length <= TOOL_OUTPUT_INLINE_MAX) return output;

  const dir = path.join(workDir, '.tool-outputs');
  fs.mkdirSync(dir, { recursive: true });
  const seq = String(++_outputSeq).padStart(4, '0');
  const filename = `${seq}-${toolName.replace(/[^a-z0-9_-]/gi, '_')}.txt`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, output, 'utf8');

  const head = output.slice(0, TOOL_OUTPUT_HEAD);
  const tail = output.slice(output.length - TOOL_OUTPUT_TAIL);
  const omitted = output.length - TOOL_OUTPUT_HEAD - TOOL_OUTPUT_TAIL;

  return [
    `[输出过长，已截断。完整内容（${output.length} 字符）已保存至：.tool-outputs/${filename}]`,
    `--- 头部（前 ${TOOL_OUTPUT_HEAD} 字符）---`,
    head,
    `--- 省略中间 ${omitted} 字符 ---`,
    `--- 尾部（后 ${TOOL_OUTPUT_TAIL} 字符）---`,
    tail,
    `[如需完整内容，可调用 read_file 读取 .tool-outputs/${filename}]`,
  ].join('\n');
}

export const EXECUTOR_SYSTEM = `你是一个反应执行器（Reactive Executor）。你的唯一职责是：
专注完成当前 Active 里程碑，通过工具调用推进目标。

执行规则：
- 只做「当前 Active 里程碑」要求的事，不碰其他里程碑
- 严格遵守 Constraints 里的所有约束，红线绝对不可越
- 特别注意 Constraints 中标注「人类指示」的条目，这是最高优先级的实时指令，必须按其执行
- 优先参考 Skills 里已有的成功操作模式，避免重复探索
- 文件路径使用相对路径（相对于工作目录）
- 不要直接修改 .brain/ 目录下的文件（由框架管理）
- 当你认为本次执行循环做得差不多了，停止调用工具
- 归因由框架强制执行，你不需要自我评估是否完成

严禁行为（必须避免）：
- ❌ 禁止将「读取到旧报告/已有文件」等价为「当前里程碑已完成」——旧文件是历史记录，不代表当前里程碑的工作已执行
- ❌ 禁止在没有实际调用工具执行操作的情况下，把里程碑标记为 [Completed]
- ❌ 里程碑要求「用浏览器/playwright 操作」时，必须实际调用 web_search(engine:playwright) 进行操作，不能跳过
- ❌ 里程碑要求「等待人类完成某操作后继续」时，必须先通过工具确认该操作已完成（如网页状态变化），不能直接跳过`;

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
  const constraints  = BrainFS.tail(brain.readConstraints()  || '暂无约束',    CONSTRAINTS_MAX);
  const environment  = BrainFS.tail(brain.readEnvironment()  || '暂无环境信息', ENVIRONMENT_MAX);
  const knowledge    = BrainFS.tail(brain.readKnowledge()    || '暂无已知事实', KNOWLEDGE_MAX);

  // 动态技能发现：用里程碑标题+描述检索最相关的 top-K 技能
  const skillQuery = `${activeMilestone.title} ${activeMilestone.description}`;
  const matchedSkills = brain.searchSkills(skillQuery, SKILLS_TOP_K);
  let skills = '暂无已积累技能';
  if (matchedSkills.length > 0) {
    const rawContent = brain.readSkillFiles(matchedSkills);
    // 单条截断后拼接，防止多条技能加起来过长
    const truncated = matchedSkills.map(entry => {
      const fp = `skills/${entry.category}/${entry.id}.md`;
      const content = rawContent.split('---').find(p => p.includes(entry.id)) ?? '';
      return content.length > SKILL_FILE_MAX
        ? content.slice(0, SKILL_FILE_MAX) + `\n…（技能内容已截断，完整内容见 .brain/${fp}）`
        : content;
    }).filter(Boolean);
    skills = truncated.length > 0
      ? `（已从技能库动态检索 ${matchedSkills.length} 条相关技能）\n\n` + truncated.join('\n\n---\n\n')
      : '暂无已积累技能';
  }

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

  /** 单次 Executor 最多工具调用轮次，防止 LLM 持续输出工具调用导致无限循环 */
  const MAX_EXEC_ROUNDS = 50;

  for (let round = 0; round < MAX_EXEC_ROUNDS; round++) {
    if (round === MAX_EXEC_ROUNDS - 1) {
      logger.warn('executor', { event: 'llm.max_rounds', data: { round, milestoneId: activeMilestone.id } });
    }
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
          tool_call_id: tc.id,
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

      // 压缩超长 output：完整内容写文件，executionLog 和 messages 用摘要
      const compressedOutput = compressToolOutput(tc.name, toolResult.output, workDir);
      const compressedResult = { ok: toolResult.ok, output: compressedOutput };

      const entry: ExecutionEntry = { toolName: tc.name, args: tc.args, result: compressedResult };
      executionLog.push(entry);

      toolResultMsgs.push({
        role: 'tool',
        content: JSON.stringify(compressedResult),
        tool_call_id: tc.id,
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
