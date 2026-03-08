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
  const channelRegistry = new ChannelRegistry();
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

  // ── 消息处理器（核心路由逻辑）────────────────────────────────────────────

  async function onInboundMessage(msg: InboundMessage): Promise<void> {
    logger.info('outer-brain', {
      event: 'msg.received',
      data: {
        thread:  msg.thread_id,
        user:    msg.user_id,
        mention: msg.is_mention,
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
      await runConversation(msg);
      return;
    }

    if (msg.is_mention) {
      await runConversation(msg);
      return;
    }

    // 非 @mention 群消息：参与决策
    const currentSoul    = soulLoader.get();
    const innerStatus    = getInnerStatus();
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
      participationEngine.recordSpeak(msg.thread_id);
      await runConversation(msg);
    } else {
      threadStore.getOrCreate(msg);
      threadStore.appendUser(msg.thread_id, msg.user_id, msg.content, msg.ts);
      logger.debug('outer-brain', {
        event: 'group.silent',
        data: { thread: msg.thread_id, msg: msg.content.slice(0, 60) },
      });
    }
  }

  async function runConversation(msg: InboundMessage): Promise<void> {
    const currentSoul = soulLoader.get();
    try {
      await conversationLoop.process(msg, currentSoul);
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
    pushLoop?.stop();
    escalationMgr.cancelAll();
    soulLoader.stop();
    await channelRegistry.stopAll();

    logger.info('outer-brain', { event: 'stop', data: {} });
  }

  return { channelRegistry, userStore, threadStore, start, stop };
}
