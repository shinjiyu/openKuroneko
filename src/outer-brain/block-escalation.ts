/**
 * BLOCK 升级通知梯
 *
 * 内脑 BLOCK 时，外脑主动联系 target_user 以解除阻塞。
 *
 * 流程：
 * 1. 按 channel priority 排序，依次向每个 channel 发通知
 * 2. 等待该 channel 回复（escalation_wait_ms，默认 30min）
 * 3. 回复到达 → 立即解封；超时 → 尝试下一 channel
 * 4. 全部失败 → 通知 owner_users（兜底）
 *
 * 并发回复处理：
 * - 先到的有效回复解封
 * - 后续回复仍作为指令处理（不丢失）
 */

import type { UserStore } from '../users/store.js';
import type { ChannelRegistry } from '../channels/registry.js';
import type { Logger } from '../logger/index.js';
import type { InboundMessage } from '../channels/types.js';

export interface BlockEvent {
  reason: string;
  question: string;
  target_user: string;
  /** 用于调用回调时标识本次 BLOCK */
  block_id: string;
}

export interface BlockResolution {
  block_id: string;
  reply: string;
  from_user: string;
  from_thread: string;
  resolved_at: number;
}

type ResolutionCallback = (resolution: BlockResolution) => void;

interface EscalationState {
  blockEvent:    BlockEvent;
  channelIndex:  number;
  timer:         ReturnType<typeof setTimeout> | null;
  resolved:      boolean;
  onResolved:    ResolutionCallback;
  sentThreadIds: Set<string>;
}

export class BlockEscalationManager {
  private readonly userStore: UserStore;
  private readonly channelRegistry: ChannelRegistry;
  private readonly logger: Logger;

  /** block_id → 升级状态 */
  private readonly active = new Map<string, EscalationState>();

  /** 每次等待时间（每个 channel），默认 30min */
  private readonly escalationWaitMs: number;

  /** 兜底 owner 用户列表（若所有 channel 超时） */
  private readonly ownerUsers: string[];

  constructor(opts: {
    userStore: UserStore;
    channelRegistry: ChannelRegistry;
    logger: Logger;
    escalationWaitMs?: number;
    ownerUsers?: string[];
  }) {
    this.userStore        = opts.userStore;
    this.channelRegistry  = opts.channelRegistry;
    this.logger           = opts.logger;
    this.escalationWaitMs = opts.escalationWaitMs ?? 30 * 60 * 1000;
    this.ownerUsers       = opts.ownerUsers ?? [];
  }

  /**
   * 启动 BLOCK 通知升级流程。
   * @returns 一个 Promise，在 BLOCK 解除时 resolve（携带 BlockResolution）
   */
  async waitForResolution(event: BlockEvent): Promise<BlockResolution> {
    return new Promise((resolve) => {
      const state: EscalationState = {
        blockEvent:    event,
        channelIndex:  0,
        timer:         null,
        resolved:      false,
        onResolved:    resolve,
        sentThreadIds: new Set(),
      };

      this.active.set(event.block_id, state);
      this.logger.info('block-escalation', {
        event: 'escalation.start',
        data: { block_id: event.block_id, target_user: event.target_user },
      });

      void this.escalateNext(state);
    });
  }

  /**
   * 当收到用户消息时调用此方法检查是否能解除 BLOCK。
   * 每个 active block 都会检查。
   */
  async onInboundMessage(msg: InboundMessage): Promise<void> {
    for (const [blockId, state] of this.active) {
      if (state.resolved) continue;

      // 只接受目标用户从已通知的 thread 发来的回复
      const isTargetUser   = msg.user_id === state.blockEvent.target_user;
      const isNotifiedThread = state.sentThreadIds.has(msg.thread_id);

      if (!isTargetUser || !isNotifiedThread) continue;

      // 有效回复，解封
      this.resolve(blockId, state, {
        block_id:    blockId,
        reply:       msg.content,
        from_user:   msg.user_id,
        from_thread: msg.thread_id,
        resolved_at: Date.now(),
      });

      // 记录响应时间，用于 channel priority 动态学习
      const startTs = Date.now() - (this.escalationWaitMs * state.channelIndex);
      this.userStore.recordBlockResponse(
        msg.user_id,
        msg.channel_id,
        Date.now() - startTs,
      );
    }
  }

  cancelAll(): void {
    for (const [blockId, state] of this.active) {
      if (state.timer) clearTimeout(state.timer);
      this.logger.info('block-escalation', { event: 'escalation.cancel', data: { block_id: blockId } });
    }
    this.active.clear();
  }

  // ── 私有 ──────────────────────────────────────────────────────────────────

  private async escalateNext(state: EscalationState): Promise<void> {
    if (state.resolved) return;

    const channels = this.userStore.getChannelsByPriority(state.blockEvent.target_user);

    if (state.channelIndex >= channels.length) {
      // 所有 channel 超时，通知 owner
      await this.notifyOwners(state);
      return;
    }

    const ch = channels[state.channelIndex];
    if (!ch) return;

    const threadId = `${ch.channel_id}:dm:${ch.raw_id}`;
    const notifyMsg =
      `【任务阻塞通知】\n` +
      `原因：${state.blockEvent.reason}\n\n` +
      `${state.blockEvent.question}\n\n` +
      `（请直接回复本消息即可）`;

    try {
      await this.channelRegistry.send({ thread_id: threadId, content: notifyMsg });
      state.sentThreadIds.add(threadId);

      this.logger.info('block-escalation', {
        event: 'escalation.sent',
        data: {
          block_id:   state.blockEvent.block_id,
          channel_id: ch.channel_id,
          thread_id:  threadId,
          level:      state.channelIndex,
        },
      });
    } catch (e) {
      this.logger.warn('block-escalation', {
        event: 'escalation.send_fail',
        data: { channel_id: ch.channel_id, error: String(e) },
      });
    }

    // 等待超时后升级到下一 channel
    state.timer = setTimeout(() => {
      if (state.resolved) return;
      state.channelIndex++;
      void this.escalateNext(state);
    }, this.escalationWaitMs);
  }

  private async notifyOwners(state: EscalationState): Promise<void> {
    for (const ownerId of this.ownerUsers) {
      const ownerChannels = this.userStore.getChannelsByPriority(ownerId);
      if (!ownerChannels.length) continue;
      const ch = ownerChannels[0];
      if (!ch) continue;

      const threadId = `${ch.channel_id}:dm:${ch.raw_id}`;
      const msg =
        `【升级告警】用户 ${state.blockEvent.target_user} 未响应 BLOCK 通知。\n` +
        `BLOCK 原因：${state.blockEvent.reason}\n` +
        `问题：${state.blockEvent.question}`;

      try {
        await this.channelRegistry.send({ thread_id: threadId, content: msg });
        state.sentThreadIds.add(threadId);
        this.logger.warn('block-escalation', {
          event: 'escalation.owner_notified',
          data: { owner: ownerId, block_id: state.blockEvent.block_id },
        });
      } catch { /* best effort */ }
    }
  }

  private resolve(blockId: string, state: EscalationState, resolution: BlockResolution): void {
    if (state.resolved) return;
    state.resolved = true;
    if (state.timer) clearTimeout(state.timer);

    this.active.delete(blockId);
    state.onResolved(resolution);

    this.logger.info('block-escalation', {
      event: 'escalation.resolved',
      data: { block_id: blockId, from_thread: resolution.from_thread },
    });
  }
}
