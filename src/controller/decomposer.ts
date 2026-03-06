/**
 * 模式 A — 战术拆解器（Tactical Decomposer）
 *
 * 输入：goal.md + constraints.md + (可选) milestones.md + replanReason
 * 输出：直接写入 .brain/milestones.md
 * 工具：无
 */

import type { LLMAdapter } from '../adapter/index.js';
import type { Logger } from '../logger/index.js';
import type { BrainFS } from '../brain/index.js';
import type { KnowledgeStore } from '../archive/index.js';

export const DECOMPOSE_SYSTEM = `你是一个战术拆解器（Tactical Decomposer）。你的唯一职责是：
根据目标和约束，制定一个 3-5 条里程碑的行动计划。

输出规则：
- 输出内容将直接写入 milestones.md，不要有任何额外解释、markdown 代码块或前言
- 格式严格遵守（使用破折号 — 分隔标题和说明）：
    [M1] [Active]  <里程碑标题> — <一句话说明>
    [M2] [Pending] <里程碑标题> — <一句话说明>
- 第一个可执行里程碑标记为 Active，其余为 Pending
- 里程碑描述停留在「做什么」层次，不涉及具体命令、参数、文件名
- 必须遵守 Constraints 里的所有红线禁令，不得规划违反红线的里程碑
- 重规划时可借鉴旧里程碑，但必须整体重写，不能只改一条`;

export interface DecomposeResult {
  ok: boolean;
  milestonesContent: string;
  error?: string;
}

export async function runDecomposer(
  brain: BrainFS,
  replanReason: string | null,
  llm: LLMAdapter,
  logger: Logger,
  knowledgeStore?: KnowledgeStore,
): Promise<DecomposeResult> {
  const goal        = brain.readGoal()        || '（goal.md 为空）';
  const constraints = brain.readConstraints() || '暂无约束';
  const milestones  = brain.readMilestones()  || '尚无里程碑';

  const reason = replanReason ?? '初次规划';

  // 检索历史经验（仅初次规划时触发，重规划时也触发以利用失败经验）
  let historicalContext = '';
  if (knowledgeStore) {
    try {
      const sessions = await knowledgeStore.retrieve(goal);
      historicalContext = knowledgeStore.buildContext(sessions);
    } catch { /* 检索失败不阻断规划 */ }
  }

  const userMessage = [
    `## Goal\n${goal}`,
    `## Constraints\n${constraints}`,
    `## Current Milestones（重规划时参考，初次为空）\n${milestones}`,
    `## Reason\n${reason}`,
    historicalContext ? historicalContext : '',
  ].filter(Boolean).join('\n\n---\n\n');

  logger.info('decomposer', { event: 'decompose.start', data: { reason } });

  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    try {
      const result = await llm.chat(DECOMPOSE_SYSTEM, [{ role: 'user', content: userMessage }], []);
      const content = result.content?.trim() ?? '';

      // 基本格式校验：至少有一条 [Mx] [Active|Pending|Completed] 行
      if (!/\[M\d+\]\s+\[(Active|Pending|Completed)\]/i.test(content)) {
        logger.warn('decomposer', {
          event: 'decompose.format.invalid',
          data: { attempt, preview: content.slice(0, 200) },
        });
        if (attempt < 2) continue; // 重试一次
        return { ok: false, milestonesContent: '', error: 'Decomposer 输出格式不合法（重试后仍失败）' };
      }

      logger.info('decomposer', {
        event: 'decompose.done',
        data: { lines: content.split('\n').length },
      });
      return { ok: true, milestonesContent: content };
    } catch (e) {
      logger.error('decomposer', { event: 'decompose.llm.error', data: { error: String(e) } });
      if (attempt < 2) continue;
      return { ok: false, milestonesContent: '', error: String(e) };
    }
  }

  return { ok: false, milestonesContent: '', error: '未知错误' };
}
