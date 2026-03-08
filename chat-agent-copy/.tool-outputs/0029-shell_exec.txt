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
 * 5. PushLoop 并行运行，监控内脑 output
 */

import fs from 'node:fs';
import path from 'node:path';

import type { LLMAdapter } from '../adapter/index.js';
import type { Logger } from '../logger/index.js';
import type { InboundMessage, InnerBrainStatus } from '../channels/types.js';
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
  createSearchThreadTool,
  obGetTimeTool,
} from './tools/index.js';
import type { ObTool } from './tools/index.js';
import { InnerBrainManager } from './inner-brain-manager.js';

export interface OuterBrainOptions {
  /** 外脑工作目录（存储 threads/、users.json、soul.md） */
  obDir: string;
  /** 内脑临时目录（读取 status、output、写入 input、directives） */
  innerTempDir: string;
  llm:    LLMAdapter;
  logger: Logger;
  /** 额外注册的 ChannelAdapter 列表（CLI/Feishu/WeChat 等） */
  extraAdapters?: import('../channels/types.js').ChannelAdapter[];
  /** soul.md 路径（默认 <obDir>/soul.md） */
  soulPath?: string | undefined;
  /** BLOCK 升级等待时间（ms），默认 30min */
  escalationWaitMs?: number;
  /**
   * 内脑进程管理器（可选）。
   * 提供后，set_goal 工具会在内脑未运行时自动启动它。
   * 不提供时需手动管理内脑进程。
   */
  innerBrainMgr?: InnerBrainManager | undefined;
  /**
   * 快速模型（可选）。用于群聊参与决策（SPEAK/SILENT 分类）。
   * 建议使用无 thinking 的 flash 级模型以降低延迟。
   * 不提供则 ParticipationEngine 回退到主力 llm。
   */
  fastLlm?: LLMAdapter | undefined;
}

export { InnerBrainManager };

export interface OuterBrain {
  channelRegistry: ChannelRegistry;
  userStore:       UserStore;
  threadStore:     ThreadStore;
  start():         Promise<void>;
  stop():          Promise<void>;
}

export function createOuterBrain(opts: OuterBrainOptions): OuterBrain {
  const { obDir, innerTempDir, llm, logger } = opts;

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

  // ── 内脑状态读取 ──────────────────────────────────────────────────────────
  const statusFile = path.join(innerTempDir, 'status');
  function getInnerStatus(): InnerBrainStatus | null {
    if (!fs.existsSync(statusFile)) return null;
    try {
      return JSON.parse(fs.readFileSync(statusFile, 'utf8')) as InnerBrainStatus;
    } catch {
      return null;
    }
  }

  // ── 外脑工具集 ────────────────────────────────────────────────────────────
  const tools: ObTool[] = [
    createReadInnerStatusTool(innerTempDir),
    createSendDirectiveTool(innerTempDir),
    createSetGoalTool(innerTempDir, opts.innerBrainMgr),
    ...(opts.innerBrainMgr ? [createStopInnerBrainTool(opts.innerBrainMgr)] : []),
    createSearchThreadTool(threadStore),
    obGetTimeTool,
  ];

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
  const pushLoop = new PushLoop({
    innerTempDir,
    channelRegistry,
    userStore,
    threadStore,
    escalationMgr,
    logger,
  });

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

    // 更新用户最近活跃时间
    userStore.updateLastSeen(msg.user_id);

    // 通知 BLOCK 升级管理器（检查是否是 BLOCK 解封回复）
    await escalationMgr.onInboundMessage(msg);

    const isGroup = msg.thread_id.includes(':group:');

    if (!isGroup) {
      // ── DM：直接对话 ────────────────────────────────────────────────────
      await runConversation(msg);
      return;
    }

    // ── 群聊路由 ─────────────────────────────────────────────────────────
    if (msg.is_mention) {
      // 被 @mention，必须响应
      await runConversation(msg);
      return;
    }

    // 非 @mention 群消息：参与决策
    const currentSoul   = soulLoader.get();
    const innerStatus   = getInnerStatus();
    const innerStatusStr = innerStatus
      ? `模式:${innerStatus.mode} 里程碑:${innerStatus.milestone?.title ?? '无'} blocked:${innerStatus.blocked}`
      : '未知';

    // 构建最近群聊记录（简要版，用于 LLM 判断）
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
      // 静默，但仍记录消息到 thread 历史
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
    pushLoop.start();

    logger.info('outer-brain', {
      event: 'start',
      data: {
        channels: channelRegistry.getAllAdapters().map((a) => a.channel_id),
        soul:     soulLoader.get().name,
        obDir,
      },
    });
  }

  async function stop(): Promise<void> {
    pushLoop.stop();
    escalationMgr.cancelAll();
    soulLoader.stop();
    await channelRegistry.stopAll();

    logger.info('outer-brain', { event: 'stop', data: {} });
  }

  return { channelRegistry, userStore, threadStore, start, stop };
}
