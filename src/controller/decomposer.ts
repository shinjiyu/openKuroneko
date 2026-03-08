/**
 * 模式 A — 战术拆解器（Tactical Decomposer）
 *
 * 输入：goal.md + constraints.md + (可选) milestones.md + replanReason
 * 输出：直接写入 .brain/milestones.md
 * 工具：无
 */

import type { LLMAdapter } from '../adapter/index.js';
import type { Logger } from '../logger/index.js';
import { BrainFS } from '../brain/index.js';
import type { KnowledgeStore } from '../archive/index.js';

// Decomposer 读取 brain 文件时的字符上限（取最近内容）
const CONSTRAINTS_MAX = 4000;
const MILESTONES_MAX  = 3000;

export const DECOMPOSE_SYSTEM = `你是一个战术拆解器（Tactical Decomposer）。你的唯一职责是：
根据目标和约束，制定一个 3-5 条里程碑的行动计划。

## 输出格式

输出内容将直接写入 milestones.md，不要有任何额外解释、markdown 代码块或前言。

### 普通里程碑（一次性任务）

    [M1] [Active]  <里程碑标题> — <一句话说明>
    [M2] [Pending] <里程碑标题> — <一句话说明>

### 循环里程碑（需要周期性重复执行的任务）

    [M1] [Active] [cyclic:N] <里程碑标题> — <一句话说明（含终止条件）>

- N 为循环间隔（毫秒）。常用值：
  - 3600000  = 1 小时
  - 86400000 = 24 小时（一天）
  - 604800000 = 7 天
- 循环里程碑**不会因为一轮执行完就标记完成**，而是休眠 N 毫秒后自动再次执行
- 终止条件写在描述中，Attributor 每轮结束后自行判断是否满足
- 满足终止条件时 Attributor 返回 SUCCESS_AND_NEXT，进入下一个普通里程碑

### 何时使用循环里程碑

使用循环里程碑，当且仅当目标满足以下**全部**条件：
✅ 任务需要周期性重复（如"每天发帖"、"每小时检查"）
✅ 有明确的终止条件（如"粉丝达 100"、"价格低于 XX"）
✅ 两次执行之间有明显的等待期（无需等待则用普通 CONTINUE 循环即可）

❌ 不要用于：一次性调研任务、代码开发、文档撰写等线性任务

## 其他规则

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
  const constraints = BrainFS.tail(brain.readConstraints() || '暂无约束', CONSTRAINTS_MAX);
  const milestones  = BrainFS.tail(brain.readMilestones()  || '尚无里程碑', MILESTONES_MAX);

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

  // 格式校验失败时最多重试 2 次（LLM 错误已在 adapter 层带退避重试，此处不再重试）
  const FORMAT_RETRIES = 2;
  for (let attempt = 1; attempt <= FORMAT_RETRIES; attempt++) {
    let content: string;
    try {
      const result = await llm.chat(DECOMPOSE_SYSTEM, [{ role: 'user', content: userMessage }], []);
      content = result.content?.trim() ?? '';
    } catch (e) {
      // LLM adapter 已穷尽所有重试（含退避），直接报 BLOCK
      logger.error('decomposer', { event: 'decompose.llm.error', data: { error: String(e) } });
      return { ok: false, milestonesContent: '', error: String(e) };
    }

    // 基本格式校验：至少有一条 [Mx] [Active|Pending|Completed]（可选 [cyclic:N]）行
    if (!/\[M\d+\]\s+\[(Active|Pending|Completed)\](\s+\[cyclic:\d+\])?/i.test(content)) {
      logger.warn('decomposer', {
        event: 'decompose.format.invalid',
        data: { attempt, preview: content.slice(0, 200) },
      });
      if (attempt < FORMAT_RETRIES) {
        // 格式错误：等 2s 再请求一次（通常是模型输出不稳定）
        await new Promise<void>((r) => setTimeout(r, 2_000));
        continue;
      }
      return { ok: false, milestonesContent: '', error: 'Decomposer 输出格式不合法（重试后仍失败）' };
    }

    logger.info('decomposer', {
      event: 'decompose.done',
      data: { lines: content.split('\n').length },
    });
    return { ok: true, milestonesContent: content };
  }

  return { ok: false, milestonesContent: '', error: '未知错误' };
}
