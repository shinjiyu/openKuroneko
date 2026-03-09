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

    // 太短的消息：level < 3 时忽略单字/两字（表情、语气词）；level >= 3 时允许 2 字以上（如「好」「行啊」）
    const minLen = level >= 3 ? 2 : 3;
    if (msg.content.trim().length < minLen) return false;

    // ── 规则兜底：明显叫大家/你们参与的句子（level>=3 时直接 SPEAK，避免 LLM 判 SILENT）────────────────
    if (level >= 3) {
      const t = msg.content.trim();
      if (
        /你们俩|你们俩先|大家.*(说|来|发表|介绍|商量|认识)|怎么都不说话|我让你们说话|都不说话了|都别不说话/.test(t) ||
        /我们来讨论|每人说一下|各自发表|先互相认识/.test(t)
      ) {
        this.logger.info('participation', {
          event: 'speak_decision',
          data: { thread: msg.thread_id, decision: 'SPEAK', reason: 'rule_group_invite', preview: t.slice(0, 80) },
        });
        state.last_proactive_at = now;
        state.proactive_count_5min++;
        return true;
      }
    }

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
      level >= 3 ? '像真人一样参与群聊：该接话就接话，有人叫大家/你们/各位时你是其中一员，应自然参与' :
      level >= 2 ? '正常参与：有实质贡献或话题相关时发言，被邀请参与时回应' :
                   '谨慎：只回答直接问题';

    const speakCriteria =
      level >= 3
        ? `可以发言（满足任一即可，像群成员一样自然）：
- 消息在叫大家/所有人/你们/各位参与（如"大家…""你们俩…""我们来…""每人说一下"）——你是群里一员，可以接话或参与
- 有人提问、讨论、征求意见，你有话可说（哪怕简短接一句）
- 话题与你或你正在做的任务相关
- 有人在问「谁不说话」「怎么都不说话」等，可能包括你在内
- 对话里有明显错误需要纠正`
        : `可以发言（满足任一）：
- 消息邀请所有成员参与（如"大家自我介绍"、"你们各自发表下看法"、"我们来讨论下"等）——你是群成员，应参与
- 有人询问你是谁、在做什么，或明显在说"另一个人不说话"等暗指你的话
- 消息与你正在执行的任务直接相关
- 有人向全体提问且你有有用答案
- 对话中出现重要错误需要纠正`;

    const systemPrompt = `你是 ${soul.name}，${soul.persona}。
你是群聊里的一个真实成员，现在收到一条新消息，你没有被 @。请判断你是否应该主动接话/参与。
参与策略：${aggressiveness}。

${speakCriteria}

必须保持沉默的情况（优先级最高）：
- 消息里明确 @ 了别人（且只有对方），是在和那个人单独说话，不要插嘴
- 两人在聊与你无关的私事、具体工作安排
- 话题完全与你无关且你没有任何可说的

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

      this.logger.info('participation', {
        event: 'speak_decision',
        data: { thread: msg.thread_id, decision: decision ? 'SPEAK' : 'SILENT', preview: msg.content.slice(0, 80) },
      });

      return decision;
    } catch (e) {
      this.logger.warn('participation', { event: 'llm_error', data: { error: String(e) } });
      return false;
    }
  }
}
