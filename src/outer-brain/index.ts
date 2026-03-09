/**
 * 外脑（Outer Brain）主模块
 *
 * 组装所有子模块，提供 createOuterBrain() 工厂函数。
 * 外脑是一个独立进程（CLI 入口见 src/cli/outer-brain.ts）。
 *
 * 消息处理流程：
 * 1. ChannelAdapter 收到消息 → onInboundMessage()
 * 2. ThreadStore 记录线程，UserStore 更新用户状态
 * 3. 判断消息类型：
 *    a. DM  → 直接进入 ConversationLoop
 *    b. Group @mention → ConversationLoop（高优先级）
 *    c. Group 无mention → ParticipationEngine 决策 → 可能进入 ConversationLoop
 * 4. BlockEscalationManager 检查是否是 BLOCK 解封回复
 * 5. PushLoop 并行运行，监控所有内脑实例 output
 */

import fs from 'node:fs';
import path from 'node:path';

import type { LLMAdapter } from '../adapter/index.js';
import type { Logger } from '../logger/index.js';
import type { InboundMessage } from '../channels/types.js';
import { ChannelRegistry } from '../channels/registry.js';
import { ThreadStore } from '../threads/store.js';
import { UserStore } from '../users/store.js';
import { SoulLoader } from './soul.js';
import { ConversationLoop } from './conversation-loop.js';
import { ParticipationEngine } from './participation.js';
import { BlockEscalationManager } from './block-escalation.js';
import { PushLoop } from './push-loop.js';
import {
  createReadInnerStatusTool,
  createSendDirectiveTool,
  createSetGoalTool,
  createStopInnerBrainTool,
  createListInnerBrainsTool,
  createSearchThreadTool,
  createSendFileTool,
  obGetTimeTool,
} from './tools/index.js';
import type { ObTool } from './tools/index.js';
import { InnerBrainPool } from './inner-brain-pool.js';

export interface OuterBrainOptions {
  /** 外脑工作目录（存储 threads/、users.json、soul.md） */
  obDir: string;
  llm:    LLMAdapter;
  logger: Logger;
  /** 额外注册的 ChannelAdapter 列表（CLI/Feishu/WeChat 等） */
  extraAdapters?: import('../channels/types.js').ChannelAdapter[];
  /** soul.md 路径（默认 <obDir>/soul.md） */
  soulPath?: string | undefined;
  /** BLOCK 升级等待时间（ms），默认 30min */
  escalationWaitMs?: number;
  /**
   * 内脑进程池（可选）。
   * 提供后，set_goal 工具会启动独立内脑实例。
   * 不提供时需手动管理内脑进程。
   */
  innerBrainPool?: InnerBrainPool | undefined;
  /**
   * 快速模型（可选）。用于群聊参与决策（SPEAK/SILENT 分类）。
   */
  fastLlm?: LLMAdapter | undefined;
}

export { InnerBrainPool };

export interface OuterBrain {
  channelRegistry: ChannelRegistry;
  userStore:       UserStore;
  threadStore:     ThreadStore;
  start():         Promise<void>;
  stop():          Promise<void>;
}

export function createOuterBrain(opts: OuterBrainOptions): OuterBrain {
  const { obDir, llm, logger } = opts;

  // ── 目录初始化 ────────────────────────────────────────────────────────────
  fs.mkdirSync(obDir, { recursive: true });

  // ── 核心存储 ──────────────────────────────────────────────────────────────
  const threadStore = new ThreadStore(obDir);
  const userStore   = new UserStore(obDir);

  // ── 频道注册表 ────────────────────────────────────────────────────────────
  const channelRegistry = new ChannelRegistry({ logger });
  for (const adapter of opts.extraAdapters ?? []) {
    channelRegistry.register(adapter);
  }

  // ── Soul 加载器 ───────────────────────────────────────────────────────────
  const soulPath   = opts.soulPath ?? path.join(obDir, 'soul.md');
  const soulLoader = new SoulLoader(soulPath, logger);

  // ── 内脑状态读取（汇总所有活跃实例）────────────────────────────────────
  function getInnerStatus(): import('../channels/types.js').InnerBrainStatus | null {
    const pool = opts.innerBrainPool;
    if (!pool) return null;

    const running = pool.runningInstances();
    if (!running.length) return null;

    // 返回最新启动实例的状态作为主状态展示
    const latest = running[0]!;
    const statusFile = path.join(latest.tempDir, 'status');
    if (!fs.existsSync(statusFile)) return null;
    try {
      return JSON.parse(fs.readFileSync(statusFile, 'utf8')) as import('../channels/types.js').InnerBrainStatus;
    } catch {
      return null;
    }
  }

  // ── 外脑工具集 ────────────────────────────────────────────────────────────
  const tools: ObTool[] = [
    createSearchThreadTool(threadStore),
    createSendFileTool(channelRegistry),
    obGetTimeTool,
  ];

  if (opts.innerBrainPool) {
    const pool = opts.innerBrainPool;
    tools.push(
      createSetGoalTool(pool),
      createStopInnerBrainTool(pool),
      createSendDirectiveTool(pool),
      createReadInnerStatusTool(pool),
      createListInnerBrainsTool(pool),
    );
  }

  // ── 对话 Loop ─────────────────────────────────────────────────────────────
  const conversationLoop = new ConversationLoop({
    llm,
    threadStore,
    userStore,
    channelRegistry,
    tools,
    logger,
    getInnerStatus,
  });

  // ── 群聊参与决策 ──────────────────────────────────────────────────────────
  const participationEngine = new ParticipationEngine(llm, logger, opts.fastLlm);

  // ── BLOCK 升级管理器 ──────────────────────────────────────────────────────
  const soul = soulLoader.get();
  const escalationMgr = new BlockEscalationManager({
    userStore,
    channelRegistry,
    logger,
    ...(opts.escalationWaitMs !== undefined ? { escalationWaitMs: opts.escalationWaitMs } : {}),
    ownerUsers: soul.owner_users,
  });

  // ── 主动推送 Loop ─────────────────────────────────────────────────────────
  const pushLoop = opts.innerBrainPool
    ? new PushLoop({
        pool:            opts.innerBrainPool,
        channelRegistry,
        userStore,
        threadStore,
        escalationMgr,
        logger,
      })
    : null;

  // ── 群聊参与延迟（1~5s 随机，新消息重置；超过 10 条不再重置，形成对话感）────────────────

  const DELAY_MIN_MS = 1000;
  const DELAY_MAX_MS = 5000;
  const MAX_PENDING_BEFORE_NO_RESET = 10;

  interface ParticipateDelayState {
    timer: ReturnType<typeof setTimeout> | null;
    queue: InboundMessage[];
  }
  const participateDelayByThread = new Map<string, ParticipateDelayState>();

  function randomDelayMs(): number {
    return DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1));
  }

  function getOrCreateDelayState(threadId: string): ParticipateDelayState {
    let s = participateDelayByThread.get(threadId);
    if (!s) {
      s = { timer: null, queue: [] };
      participateDelayByThread.set(threadId, s);
    }
    return s;
  }

  function scheduleParticipateFlush(threadId: string): void {
    const state = getOrCreateDelayState(threadId);
    if (state.timer) clearTimeout(state.timer);
    const delayMs = randomDelayMs();
    state.timer = setTimeout(() => {
      state.timer = null;
      flushParticipateQueue(threadId);
    }, delayMs);
    logger.info('outer-brain', {
      event: 'participate.delay_scheduled',
      data: { thread: threadId, delayMs, queueLen: state.queue.length },
    });
  }

  function enqueueForParticipate(msg: InboundMessage): void {
    threadStore.getOrCreate(msg);
    const state = getOrCreateDelayState(msg.thread_id);
    if (state.queue.length < MAX_PENDING_BEFORE_NO_RESET) {
      state.queue.push(msg);
      scheduleParticipateFlush(msg.thread_id);
    } else {
      state.queue[MAX_PENDING_BEFORE_NO_RESET - 1] = msg;
      logger.info('outer-brain', {
        event: 'participate.delay_no_reset',
        data: { thread: msg.thread_id, reason: 'queue_full' },
      });
    }
  }

  async function flushParticipateQueue(threadId: string): Promise<void> {
    const state = participateDelayByThread.get(threadId);
    if (!state || state.queue.length === 0) return;
    const queue = state.queue.slice();
    state.queue = [];

    const last = queue[queue.length - 1]!;
    for (const m of queue) {
      threadStore.getOrCreate(m);
      threadStore.appendUser(m.thread_id, m.user_id, m.content, m.ts);
    }

    await runParticipateDecision(last, { alreadyAppended: true });
  }

  async function runParticipateDecision(
    msg: InboundMessage,
    opts?: { alreadyAppended?: boolean },
  ): Promise<void> {
    const currentSoul = soulLoader.get();
    const innerStatus = getInnerStatus();
    const innerStatusStr = innerStatus
      ? `模式:${innerStatus.mode} 里程碑:${innerStatus.milestone?.title ?? '无'} blocked:${innerStatus.blocked}`
      : '未知';

    const recentHistory = threadStore.getHistory(msg.thread_id).slice(-10);
    const recentText = recentHistory
      .map((h) => `${h.role === 'user' ? (h.user_id ?? 'user') : 'agent'}: ${h.content}`)
      .join('\n');

    const shouldSpeak = await participationEngine.shouldSpeak(
      msg,
      recentText,
      currentSoul,
      innerStatusStr,
    );

    if (shouldSpeak) {
      logger.info('outer-brain', {
        event: 'group.proactive_speak',
        data: { thread: msg.thread_id },
      });
      logger.info('outer-brain', {
        event: 'conversation.start',
        data: { thread: msg.thread_id, reason: 'proactive' },
      });
      participationEngine.recordSpeak(msg.thread_id);
      await runConversation(msg, { skipAppendUser: opts?.alreadyAppended });
    } else {
      if (!opts?.alreadyAppended) {
        threadStore.getOrCreate(msg);
        threadStore.appendUser(msg.thread_id, msg.user_id, msg.content, msg.ts);
      }
      logger.info('outer-brain', {
        event: 'group.skip',
        data: { thread: msg.thread_id, reason: 'silent', preview: msg.content.slice(0, 60) },
      });
    }
  }

  // ── 消息去重（同一条消息不重复回复，避免飞书重试/双通道导致多次回复）────────────────

  const PROCESSED_MSG_TTL_MS = 5 * 60 * 1000;
  const processedMessageIds = new Set<string>();
  function markProcessedAndDedupe(msgId: string): boolean {
    if (processedMessageIds.has(msgId)) return true; // 已处理过，视为重复
    processedMessageIds.add(msgId);
    setTimeout(() => processedMessageIds.delete(msgId), PROCESSED_MSG_TTL_MS);
    return false;
  }

  /** DM 空内容或仅占位符（[图片][表情] 等）不触发回复，只记入 thread */
  function isDmContentEmptyOrPlaceholder(content: string): boolean {
    const t = content.trim();
    if (!t) return true;
    const onlyPlaceholders = /^(\[图片\]|\[表情\]|\[语音\]|\[文件[^\]]*\])+$/;
    return onlyPlaceholders.test(t);
  }

  // ── 消息处理器（核心路由逻辑）────────────────────────────────────────────

  async function onInboundMessage(msg: InboundMessage): Promise<void> {
    logger.info('outer-brain', {
      event: 'msg.received',
      data: {
        thread:  msg.thread_id,
        user:    msg.user_id,
        mention: msg.is_mention,
        msg_id:  msg.id,
        preview: msg.content.slice(0, 80),
      },
    });

    // 自动注册/更新用户的 channel 绑定，确保 escalation 能找到目标 channel
    userStore.register({
      userId:      msg.user_id,
      displayName: msg.user_id,
      role:        'member',
      channels:    [{ channelId: msg.channel_id, rawId: msg.raw_user_id }],
    });
    userStore.updateLastSeen(msg.user_id);
    await escalationMgr.onInboundMessage(msg);

    const isGroup = msg.thread_id.includes(':group:');

    if (!isGroup) {
      if (markProcessedAndDedupe(msg.id)) {
        logger.info('outer-brain', {
          event: 'dm.skip',
          data: { thread: msg.thread_id, reason: 'duplicate_msg_id', msg_id: msg.id },
        });
        return;
      }
      if (isDmContentEmptyOrPlaceholder(msg.content)) {
        threadStore.getOrCreate(msg);
        threadStore.appendUser(msg.thread_id, msg.user_id, msg.content, msg.ts);
        logger.info('outer-brain', {
          event: 'dm.skip',
          data: { thread: msg.thread_id, reason: 'empty_or_placeholder', preview: msg.content.slice(0, 60) },
        });
        return;
      }
      logger.info('outer-brain', {
        event: 'conversation.start',
        data: { thread: msg.thread_id, reason: 'dm' },
      });
      await runConversation(msg);
      return;
    }

    // 群消息也做 message_id 去重，避免同一条群消息触发多次
    if (markProcessedAndDedupe(msg.id)) {
      logger.info('outer-brain', {
        event: 'group.skip',
        data: { thread: msg.thread_id, reason: 'duplicate_msg_id', msg_id: msg.id },
      });
      return;
    }

    if (msg.is_mention) {
      logger.info('outer-brain', {
        event: 'conversation.start',
        data: { thread: msg.thread_id, reason: 'mention' },
      });
      await runConversation(msg);
      return;
    }

    // 用户 @ 了别人（有 mention 但没 @ 我们）：只记入 thread，不回复
    if (msg.mentions?.length) {
      threadStore.getOrCreate(msg);
      threadStore.appendUser(msg.thread_id, msg.user_id, msg.content, msg.ts);
      logger.info('outer-brain', {
        event: 'group.skip',
        data: { thread: msg.thread_id, reason: 'mention_others', mentions: msg.mentions },
      });
      return;
    }

    // 其它机器人的发言：只记入 thread，不回复（保持上下文完整）
    if (msg.sender_type === 'app') {
      threadStore.getOrCreate(msg);
      threadStore.appendUser(msg.thread_id, msg.user_id, msg.content, msg.ts);
      logger.info('outer-brain', {
        event: 'group.skip',
        data: { thread: msg.thread_id, reason: 'other_bot', user: msg.user_id },
      });
      return;
    }

    // 非 @mention 群消息：先进入延迟队列，到期后再做参与决策（形成对话感，避免抢答）
    enqueueForParticipate(msg);
  }

  async function runConversation(msg: InboundMessage, opts?: { skipAppendUser?: boolean }): Promise<void> {
    const currentSoul = soulLoader.get();
    try {
      await conversationLoop.process(msg, currentSoul, opts);
    } catch (e) {
      logger.error('outer-brain', {
        event: 'loop.error',
        data: { thread: msg.thread_id, error: String(e) },
      });
    }
  }

  // ── 生命周期 ──────────────────────────────────────────────────────────────

  async function start(): Promise<void> {
    soulLoader.watch();
    await channelRegistry.startAll(onInboundMessage);
    pushLoop?.start();

    logger.info('outer-brain', {
      event: 'start',
      data: {
        channels: channelRegistry.getAllAdapters().map((a) => a.channel_id),
        soul:     soulLoader.get().name,
        obDir,
        pool:     opts.innerBrainPool ? 'enabled' : 'disabled',
      },
    });
  }

  async function stop(): Promise<void> {
    for (const state of participateDelayByThread.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    participateDelayByThread.clear();
    processedMessageIds.clear();
    pushLoop?.stop();
    escalationMgr.cancelAll();
    soulLoader.stop();
    await channelRegistry.stopAll();

    logger.info('outer-brain', { event: 'stop', data: {} });
  }

  return { channelRegistry, userStore, threadStore, start, stop };
}
