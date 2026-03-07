/**
 * Push Loop — 主动推送监控
 *
 * 轮询内脑 output 文件，解析 BLOCK / COMPLETE / PROGRESS 事件并做出响应：
 *
 * BLOCK：
 *   1. 解析 target_user 和 question
 *   2. 启动 BlockEscalationManager.waitForResolution()
 *   3. 等待用户回复，回复后发送 send_directive 解封
 *
 * COMPLETE：
 *   1. 读取内脑 output 内容
 *   2. 向 goal_origin_user 发送完成通知
 *
 * PROGRESS：
 *   1. 仅记录日志（可配置是否推送进度）
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import type { InnerBrainOutput } from '../channels/types.js';
import type { BlockEscalationManager } from './block-escalation.js';
import type { ChannelRegistry } from '../channels/registry.js';
import type { UserStore } from '../users/store.js';
import type { ThreadStore } from '../threads/store.js';
import type { Logger } from '../logger/index.js';

export interface PushLoopOptions {
  /** 内脑临时目录（包含 output、status 文件） */
  innerTempDir: string;
  channelRegistry: ChannelRegistry;
  userStore:       UserStore;
  /** 用于 fallback：外脑重启后 UserStore 为空时，从 ThreadStore 找历史 DM thread */
  threadStore:     ThreadStore;
  escalationMgr:   BlockEscalationManager;
  logger:          Logger;
  /** 轮询间隔（ms），默认 2000 */
  pollMs?: number;
}

export class PushLoop {
  private readonly opts: PushLoopOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private offsetFile: string;

  constructor(opts: PushLoopOptions) {
    this.opts       = opts;
    this.offsetFile = path.join(opts.innerTempDir, 'output.ob.offset');
  }

  start(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.opts.pollMs ?? 2000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const outputFile = path.join(this.opts.innerTempDir, 'output');
    if (!fs.existsSync(outputFile)) return;

    const content = this.readNewContent(outputFile);
    if (!content) return;

    const { logger } = this.opts;

    // 解析消息类型（支持 JSON 结构体和 [BLOCK]/[COMPLETE] 前缀两种格式）
    const parsed = parseInnerOutput(content);

    logger.info('push-loop', {
      event: 'inner_output',
      data: { type: parsed.type, preview: parsed.message.slice(0, 80) },
    });

    switch (parsed.type) {
      case 'BLOCK':    await this.handleBlock(parsed);    break;
      case 'COMPLETE': await this.handleComplete(parsed); break;
      case 'PROGRESS': await this.handleProgress(parsed); break;
    }
  }

  private async handleBlock(output: InnerBrainOutput): Promise<void> {
    const { escalationMgr, logger } = this.opts;

    const targetUser = output.target_user ?? this.getGoalOriginUser();
    if (!targetUser) {
      logger.warn('push-loop', { event: 'block.no_target', data: { reason: output.message } });
      return;
    }

    const blockId = randomBytes(4).toString('hex');
    logger.info('push-loop', {
      event: 'block.start_escalation',
      data: { block_id: blockId, target_user: targetUser },
    });

    // 异步等待解封，不阻塞 push loop
    void (async () => {
      const resolution = await escalationMgr.waitForResolution({
        block_id:    blockId,
        reason:      output.message,
        question:    output.question ?? output.message,
        target_user: targetUser,
      });

      // 解封 → 把用户回复发给内脑
      const directivesFile = path.join(this.opts.innerTempDir, 'directives');
      const directive = JSON.stringify({
        ts:      new Date().toISOString(),
        type:    'feedback',
        content: `[BLOCK解封] 用户回复：${resolution.reply}`,
        from:    resolution.from_user,
      });
      fs.appendFileSync(directivesFile, directive + '\n', 'utf8');

      logger.info('push-loop', {
        event: 'block.resolved',
        data: { block_id: blockId, from_thread: resolution.from_thread },
      });
    })();
  }

  private async handleComplete(output: InnerBrainOutput): Promise<void> {
    const { logger } = this.opts;
    const targetUser = output.target_user ?? this.getGoalOriginUser();
    if (!targetUser) {
      logger.warn('push-loop', { event: 'complete.no_target', data: {} });
      return;
    }

    const threadId = this.getBestThreadId(targetUser);
    if (!threadId) {
      logger.warn('push-loop', {
        event: 'complete.no_thread',
        data: { target_user: targetUser, reason: 'UserStore 和 ThreadStore 均无该用户的 DM thread' },
      });
      return;
    }

    logger.info('push-loop', {
      event: 'complete.notify',
      data: { target_user: targetUser, thread_id: threadId },
    });

    await this.opts.channelRegistry.send({
      thread_id: threadId,
      content:   `✅ 任务完成！\n\n${output.message}`,
    });
  }

  private async handleProgress(output: InnerBrainOutput): Promise<void> {
    // 目前只记录日志，可以配置是否主动推送
    this.opts.logger.info('push-loop', {
      event: 'progress',
      data: { preview: output.message.slice(0, 120) },
    });
  }

  private async forwardToOriginUser(content: string): Promise<void> {
    const targetUser = this.getGoalOriginUser();
    if (!targetUser) return;

    const threadId = this.getBestThreadId(targetUser);
    if (!threadId) return;

    await this.opts.channelRegistry.send({ thread_id: threadId, content });
  }

  private getGoalOriginUser(): string | null {
    const statusFile = path.join(this.opts.innerTempDir, 'status');
    if (!fs.existsSync(statusFile)) return null;
    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf8')) as Record<string, unknown>;
      return (status['goal_origin_user'] as string | undefined) ?? null;
    } catch {
      return null;
    }
  }

  private getBestThreadId(userId: string): string | null {
    // 优先：UserStore 动态记录的最近活跃 channel（重启后可能为空）
    const channels = this.opts.userStore.getChannelsByPriority(userId);
    if (channels.length && channels[0]) {
      const ch = channels[0];
      return `${ch.channel_id}:dm:${ch.raw_id}`;
    }

    // Fallback：从 ThreadStore（持久化）找该用户的 DM thread
    const dmThreads = this.opts.threadStore.allThreads().filter(
      (t) => t.type === 'dm' && t.peer_id === userId,
    );
    if (!dmThreads.length) return null;

    // 按最近消息时间降序，取最新的
    dmThreads.sort((a, b) => (b.last_msg_at ?? 0) - (a.last_msg_at ?? 0));
    const best = dmThreads[0];
    if (!best) return null;

    this.opts.logger.info('push-loop', {
      event: 'complete.thread_fallback',
      data: { target_user: userId, thread_id: best.thread_id },
    });
    return best.thread_id;
  }

  // ── 工具函数 ──────────────────────────────────────────────────────────────

  // ── offset-based 增量读取（兼容内脑 output 文件）────────────────────────

  private readOffset(): number {
    try {
      return parseInt(fs.readFileSync(this.offsetFile, 'utf8'), 10) || 0;
    } catch {
      return 0;
    }
  }

  private writeOffset(n: number): void {
    fs.writeFileSync(this.offsetFile, String(n), 'utf8');
  }

  private readNewContent(filePath: string): string | null {
    const stat   = fs.statSync(filePath);
    const offset = this.readOffset();
    if (stat.size <= offset) return null;

    const fd  = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(stat.size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    this.writeOffset(stat.size);

    const content = buf.toString('utf8').trim();
    return content || null;
  }
}

// ── 模块级辅助函数 ────────────────────────────────────────────────────────────

/**
 * 解析内脑 output 内容，兼容两种格式：
 * 1. JSON 结构体：{ type, message, target_user, question, ts }
 * 2. 前缀文本：[BLOCK] reason | [COMPLETE] message | 其他 → PROGRESS
 */
function parseInnerOutput(content: string): InnerBrainOutput {
  try {
    const obj = JSON.parse(content) as Partial<InnerBrainOutput>;
    if (obj.type && obj.message) {
      return {
        type:        obj.type,
        message:     obj.message,
        target_user: obj.target_user,
        question:    obj.question,
        ts:          obj.ts ?? new Date().toISOString(),
      };
    }
  } catch { /* not JSON */ }

  const ts = new Date().toISOString();
  if (content.startsWith('[BLOCK]')) {
    const reason = content.replace('[BLOCK]', '').trim();
    return { type: 'BLOCK', message: reason, question: reason, ts };
  }
  if (content.startsWith('[COMPLETE]')) {
    return { type: 'COMPLETE', message: content.replace('[COMPLETE]', '').trim(), ts };
  }

  return { type: 'PROGRESS', message: content, ts };
}
