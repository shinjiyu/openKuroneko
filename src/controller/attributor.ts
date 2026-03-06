/**
 * 模式 C — 强制归因器（Mandatory Attributor）
 *
 * 输入：activeMilestone + preState + executionLog + postState
 * 工具：write_constraint / write_skill / write_knowledge
 * 输出：从 result.content 末尾解析 CONTROL flag + REASON
 */

import type { Message, LLMAdapter } from '../adapter/index.js';
import type { Logger } from '../logger/index.js';
import type { ToolRegistry } from '../tools/index.js';
import type { Milestone, ExecutionEntry } from '../brain/index.js';

export type ControlFlag = 'CONTINUE' | 'SUCCESS_AND_NEXT' | 'REPLAN' | 'BLOCK';

export interface AttributeResult {
  flag: ControlFlag;
  reason: string;
  rawContent: string;
}

export const ATTRIBUTOR_SYSTEM = `你是一个强制归因器（Mandatory Attributor）。每次执行结束后，
你必须按顺序完成以下五项任务：

【任务 1 — 归因分析】（内部推理）
分析执行日志，找出「进展/停滞/成功/失败」的根本原因。

【任务 2 — 约束提取】（可选，失败时优先）
如果发现了应该永久避免的操作模式，调用 write_constraint 工具。
格式："[红线] <禁止行为> — <原因>"
      "[避坑] <注意事项> — <适用场景>"

【任务 3 — 技能提取】（可选，SUCCESS_AND_NEXT 时优先）
如果本次执行中有「解决了某类问题」的可复用模式，调用 write_skill 工具。
格式：
  场景：<遇到什么情况>
  步骤：<有效的操作序列，按序列出>
  验证：<如何确认成功>

【任务 4 — 知识提取】（可选）
如果发现了关于环境/项目的新客观事实，调用 write_knowledge 工具。
格式："[事实] <内容>"

【任务 5 — 控制决策】（必做，最后输出）
最后两行必须是：
CONTROL: <CONTINUE|SUCCESS_AND_NEXT|REPLAN|BLOCK>
REASON: <一句话说明原因>

判断标准：
- CONTINUE：有实质进展但里程碑未完成，继续执行
- SUCCESS_AND_NEXT：里程碑目标已达成
- REPLAN：遇到根本性障碍，当前计划不可行，且无人类协助需求，需要重新规划
- BLOCK：无法独立解决，需要外脑或人类介入（Human-in-the-loop）

【Human-in-the-loop 优先】以下情况必须使用 BLOCK，不要用 REPLAN：
- 目标需要登录/认证才能访问（如微博、需登录的网站、API 需 key），且当前无法自动登录
- 需要人类提供数据、文件、链接或手工执行某操作（如授权、确认、粘贴内容）后才能继续
- 执行日志中出现「需登录」「Sina Visitor System」「无法获取公开数据」「permission denied」等且无程序化替代方案
BLOCK 时 REASON 必须写清：需要人类具体做什么（例如：请提供 steph808 的公开信息摘要 / 请登录微博后告知继续 / 请将 XXX 文件放入工作目录后回复「已放入」）。

硬性规则（优先于其他判断）：
- 执行日志为空（没有任何工具调用）→ 必须 REPLAN
- 连续两次完全相同的工具调用均失败、且不属于上述「需人类协助」情形 → REPLAN
- 属于「需人类协助」情形 → 必须 BLOCK
- 无法判断是否有进展且不涉及人类协助 → 倾向 REPLAN，而非 CONTINUE`;

export async function runAttributor(
  activeMilestone: Milestone,
  preState: string,
  executionLog: ExecutionEntry[],
  postState: string,
  attributorToolRegistry: ToolRegistry,
  llm: LLMAdapter,
  logger: Logger,
): Promise<AttributeResult> {
  // Build execution log text
  const logSections = executionLog.length === 0
    ? '（无工具调用）'
    : executionLog.map((e, i) => [
        `### 操作 ${i + 1}`,
        `工具：${e.toolName}`,
        `参数：${JSON.stringify(e.args, null, 2)}`,
        `结果：${JSON.stringify(e.result)}`,
        e.error ? `错误：${e.error}` : '',
      ].filter(Boolean).join('\n')).join('\n\n');

  // Collect errors from log
  const errors = executionLog
    .filter(e => !e.result.ok || e.error)
    .map(e => `- ${e.toolName}: ${e.error ?? e.result.output}`)
    .join('\n');

  const milestoneText = `[${activeMilestone.id}] [Active] ${activeMilestone.title} — ${activeMilestone.description}`;

  const userMessage = [
    `## 目标里程碑\n${milestoneText}`,
    `## 执行前状态（Pre-State）\n${preState || '（无快照）'}`,
    `## 执行日志\n${logSections}`,
    `## 执行后状态（Post-State）\n${postState || '（无快照）'}`,
    errors ? `## 错误摘要\n${errors}` : '',
  ].filter(Boolean).join('\n\n---\n\n');

  logger.info('attributor', {
    event: 'attribute.start',
    data: { milestoneId: activeMilestone.id, logEntries: executionLog.length },
  });

  let currentMessages: Message[] = [{ role: 'user', content: userMessage }];
  let lastContent = '';

  // Attributor tool call loop (write_constraint / write_skill / write_knowledge)
  for (let round = 0; ; round++) {
    logger.info('attributor', { event: 'llm.call', data: { round } });

    let result;
    try {
      result = await llm.chat(ATTRIBUTOR_SYSTEM, currentMessages, attributorToolRegistry.schema());
    } catch (e) {
      logger.error('attributor', { event: 'llm.error', data: { error: String(e) } });
      return { flag: 'REPLAN', reason: `Attributor LLM 调用失败: ${String(e)}`, rawContent: '' };
    }

    lastContent = result.content ?? '';

    if (!result.toolCalls || result.toolCalls.length === 0) {
      logger.info('attributor', { event: 'llm.done', data: { round, contentLen: lastContent.length } });
      break;
    }

    const assistantMsg: Message = { role: 'assistant', content: lastContent };
    const toolResultMsgs: Message[] = [assistantMsg];

    for (const tc of result.toolCalls) {
      const tool = attributorToolRegistry.get(tc.name);
      if (!tool) {
        toolResultMsgs.push({
          role: 'tool',
          content: JSON.stringify({ ok: false, output: `Unknown tool: ${tc.name}` }),
        });
        continue;
      }

      logger.info('attributor', { event: 'tool.call', data: { name: tc.name } });
      const toolResult = await tool.call(tc.args);
      logger.info('attributor', { event: 'tool.result', data: { name: tc.name, ok: toolResult.ok } });

      toolResultMsgs.push({
        role: 'tool',
        content: JSON.stringify({ ok: toolResult.ok, output: toolResult.output }),
      });
    }

    currentMessages = [...currentMessages, ...toolResultMsgs];
  }

  // Parse CONTROL flag and REASON from the end of content
  const parsed = parseControlFlag(lastContent);

  logger.info('attributor', {
    event: 'attribute.done',
    data: { flag: parsed.flag, reason: parsed.reason },
  });

  return { ...parsed, rawContent: lastContent };
}

/** 从文本末尾提取 CONTROL 和 REASON，失败时默认 REPLAN */
export function parseControlFlag(content: string): { flag: ControlFlag; reason: string } {
  const controlMatch = content.match(/CONTROL:\s*(CONTINUE|SUCCESS_AND_NEXT|REPLAN|BLOCK)/i);
  const reasonMatch  = content.match(/REASON:\s*(.+)/i);

  if (!controlMatch || !controlMatch[1]) {
    return { flag: 'REPLAN', reason: 'Attributor 输出无法解析 CONTROL flag，保守降级为 REPLAN' };
  }

  return {
    flag:   controlMatch[1].toUpperCase() as ControlFlag,
    reason: (reasonMatch && reasonMatch[1]) ? reasonMatch[1].trim() : '（无原因说明）',
  };
}
