/**
 * 群聊主动发言决策引擎
 *
 * 决策流程：
 * 1. 规则预筛（快，无 LLM）
 * 2. 通过 → LLM 判断 SPEAK / SILENT
 * 3. 冷却期管理（防止刷屏）
 *
 * soul.md 配置：
 *   participation.proactive_level  0=沉默 1=谨慎 2=正常 3=活跃
 *   participation.speak_cooldown_ms
 *   participation.max_proactive_per_5min
 */

import type { InboundMessage } from '../channels/types.js';
import type { SoulConfig } from './soul.js';
import type { LLMAdapter } from '../adapter/index.js';
import type { Logger } from '../logger/index.js';

interface GroupSpeakState {
  /** 最近一次主动发言时间 */
  last_proactive_at: number;
  /** 最近 5min 主动发言次数 */
  proactive_count_5min: number;
  proactive_count_reset_at: number;
}

export class ParticipationEngine {
  private readonly state = new Map<string, GroupSpeakState>();
  private readonly llm: LLMAdapter;
  private readonly logger: Logger;

  /**
   * @param llm        主力 LLM（fallback）
   * @param logger     日志
   * @param fastLlm    可选：专用快速模型（用于 SPEAK/SILENT 分类，无需 thinking）
   */
  constructor(llm: LLMAdapter, logger: Logger, private readonly fastLlm?: LLMAdapter) {
    this.llm    = llm;
    this.logger = logger;
  }

  /**
   * 判断外脑是否应该在该群消息中主动发言。
   * 返回 true 表示应该发言。
   *
   * @mention 消息由上层处理（必须发言），此函数只处理非 mention 消息。
   */
  async shouldSpeak(
    msg: InboundMessage,
    recentGroupMessages: string,
    soul: SoulConfig,
    innerStatus: string,
  ): Promise<boolean> {
    const level = soul.participation.proactive_level;

    // level 0 = 完全沉默（除非 @mention，由上层处理）
    if (level === 0) return false;

    const state = this.getOrCreateState(msg.thread_id);
    const now   = Date.now();

    // ── 规则预筛 ──────────────────────────────────────────────────────────

    // 冷却期
    if (now - state.last_proactive_at < soul.participation.speak_cooldown_ms) {
      return false;
    }

    // 5min 发言上限
    if (now - state.proactive_count_reset_at > 5 * 60 * 1000) {
      state.proactive_count_5min   = 0;
      state.proactive_count_reset_at = now;
    }
    if (state.proactive_count_5min >= soul.participation.max_proactive_per_5min) {
      return false;
    }

    // level 1 = 谨慎，仅回答直接问题（规则判断）
    if (level === 1) {
      const isQuestion = msg.content.trim().endsWith('?') || msg.content.trim().endsWith('？');
      if (!isQuestion) return false;
    }

    // 太短的消息（单个表情、语气词）不值得调 LLM
    if (msg.content.trim().length < 3) return false;

    // ── LLM 判断 ────────────────────────────────────────────────────────────
    // 优先使用快速模型（无 thinking），避免主力模型浪费 token 做二分类

    const decision = await this.askLLM(msg, recentGroupMessages, soul, innerStatus, level);
    if (decision) {
      state.last_proactive_at = now;
      state.proactive_count_5min++;
    }

    return decision;
  }

  /** 记录一次主动发言（外部调用，更新状态） */
  recordSpeak(threadId: string): void {
    const state = this.getOrCreateState(threadId);
    state.last_proactive_at = Date.now();
    state.proactive_count_5min++;
  }

  // ── 私有 ──────────────────────────────────────────────────────────────────

  private getOrCreateState(threadId: string): GroupSpeakState {
    let s = this.state.get(threadId);
    if (!s) {
      s = { last_proactive_at: 0, proactive_count_5min: 0, proactive_count_reset_at: Date.now() };
      this.state.set(threadId, s);
    }
    return s;
  }

  private async askLLM(
    msg: InboundMessage,
    recentGroupMessages: string,
    soul: SoulConfig,
    innerStatus: string,
    level: number,
  ): Promise<boolean> {
    const aggressiveness =
      level >= 3 ? '偏活跃，积极融入群组社交，遇到相关话题主动发言' :
      level >= 2 ? '正常，仅在有实质性贡献时发言' :
                   '谨慎，只回答直接问题';

    const speakCriteria =
      level >= 3
        ? `可以发言（满足任一）：
- 消息邀请所有人参与（自我介绍、投票、群体提问、发表意见等）——你是群成员
- 有人提出问题，你有有用的答案或观点
- 消息与你正在执行的任务相关
- 对话中出现错误信息需要纠正`
        : `可以发言（满足任一）：
- 消息邀请所有成员参与讨论或发表看法（如"大家自我介绍"、"每人说一下"、"大家发表意见"、"你们各自发表下看法"、"我们来讨论下"等）——你是群成员，应参与
- 有人询问你是谁、你在做什么，或明显在说"另一个人不说话"等暗指你的话
- 消息与你正在执行的任务直接相关
- 有人向全体提问且你有有用的答案
- 对话中出现重要错误信息需要纠正`;

    const systemPrompt = `你是 ${soul.name}，${soul.persona}。
你是群聊中的一个成员，现在收到了一条新消息，你没有被 @。请判断你是否应该主动发言。
你的参与策略：${aggressiveness}。

${speakCriteria}

必须保持沉默的情况（优先级高于以上所有）：
- 消息中含有 @其他用户名（非你自己），说明是定向私聊，不要插嘴
- 两人在聊具体的私事、工作安排，与你无关
- 话题和你完全无关且你无法提供价值

请只输出 SPEAK 或 SILENT，不要有其他内容。`;

    const userPrompt = `当前内脑状态：
${innerStatus}

最近群聊记录：
${recentGroupMessages}

新消息（来自 ${msg.user_id}）：
${msg.content}`;

    try {
      const llm = this.fastLlm ?? this.llm;
      const result = await llm.chat(systemPrompt, [{ role: 'user', content: userPrompt }]);
      const decision = result.content.trim().toUpperCase().includes('SPEAK');

      this.logger.debug('participation', {
        event: 'speak_decision',
        data: { thread: msg.thread_id, decision: decision ? 'SPEAK' : 'SILENT', msg: msg.content.slice(0, 60) },
      });

      return decision;
    } catch (e) {
      this.logger.warn('participation', { event: 'llm_error', data: { error: String(e) } });
      return false;
    }
  }
}
