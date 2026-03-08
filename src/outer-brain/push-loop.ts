/**
 * Push Loop — 主动推送监控（多实例版）
 *
 * 轮询所有活跃内脑实例的 output 文件，解析 BLOCK / COMPLETE / PROGRESS 事件：
 *
 * BLOCK：
 *   1. 解析 target_user 和 question
 *   2. 启动 BlockEscalationManager.waitForResolution()
 *   3. 等待用户回复，回复后发送 [BLOCK解封] directive 解封
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

// ── 常量 ──────────────────────────────────────────────────────────────────────
/** 自动附件发送的文件大小上限（50 MB），超过此值只列路径不发附件 */
const AUTO_ATTACH_MAX_BYTES = 50 * 1024 * 1024;
/** 单次最多自动附送的文件数量（防止消息过多） */
const AUTO_ATTACH_MAX_COUNT = 8;

import type { InnerBrainOutput, MessageAttachment } from '../channels/types.js';
import type { BlockEscalationManager } from './block-escalation.js';
import type { ChannelRegistry } from '../channels/registry.js';
import type { UserStore } from '../users/store.js';
import type { ThreadStore } from '../threads/store.js';
import type { Logger } from '../logger/index.js';
import type { InnerBrainPool } from './inner-brain-pool.js';

export interface PushLoopOptions {
  pool:            InnerBrainPool;
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
  private readonly opts:    PushLoopOptions;
  private timer:            ReturnType<typeof setInterval> | null = null;
  /**
   * 每个实例独立维护 output.ob.offset。
   * 启动时从磁盘恢复（持久化到 <tempDir>/output.ob.offset），
   * 防止外脑重启后重复处理已有事件。
   */
  private readonly offsets: Map<string, number> = new Map();

  constructor(opts: PushLoopOptions) {
    this.opts = opts;
  }

  /** 从磁盘读取持久化 offset（外脑重启时调用） */
  private loadOffset(instanceId: string, tempDir: string): number {
    const offsetFile = path.join(tempDir, 'output.ob.offset');
    try {
      const v = parseInt(fs.readFileSync(offsetFile, 'utf8'), 10);
      return isNaN(v) ? 0 : v;
    } catch {
      return 0;
    }
  }

  /** 将 offset 持久化到磁盘 */
  private saveOffset(instanceId: string, tempDir: string, offset: number): void {
    try {
      fs.writeFileSync(path.join(tempDir, 'output.ob.offset'), String(offset), 'utf8');
    } catch { /* non-critical */ }
    this.offsets.set(instanceId, offset);
  }

  start(): void {
    this.timer = setInterval(() => {
      this.tick().catch((e) => {
        this.opts.logger.error('push-loop', {
          event: 'tick.error',
          data: { error: String(e) },
        });
      });
    }, this.opts.pollMs ?? 2000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const instances = this.opts.pool.runningInstances();
    for (const inst of instances) {
      await this.tickInstance(inst.id, inst.tempDir, inst.originUser);
    }
  }

  private async tickInstance(
    instanceId: string,
    tempDir:    string,
    originUser: string,
  ): Promise<void> {
    const outputFile = path.join(tempDir, 'output');
    if (!fs.existsSync(outputFile)) return;

    // 首次读取时从磁盘恢复 offset（防重启重复处理）
    if (!this.offsets.has(instanceId)) {
      const saved = this.loadOffset(instanceId, tempDir);
      this.offsets.set(instanceId, saved);
    }

    const newContent = this.readNewContent(instanceId, tempDir, outputFile);
    if (!newContent) return;

    // 按行分割处理，支持同一批次多事件（防止 JSON.parse 整块失败丢失 BLOCK 事件）
    const { logger } = this.opts;
    const events = parseInnerOutputLines(newContent);

    for (const parsed of events) {
      logger.info('push-loop', {
        event: 'inner_output',
        data: { instanceId, type: parsed.type, preview: parsed.message.slice(0, 80) },
      });

      switch (parsed.type) {
        case 'BLOCK':    await this.handleBlock(instanceId, tempDir, parsed, originUser);    break;
        case 'COMPLETE': await this.handleComplete(instanceId, tempDir, parsed, originUser); break;
        case 'PROGRESS': await this.handleProgress(parsed);                                  break;
      }
    }
  }

  private async handleBlock(
    instanceId: string,
    tempDir:    string,
    output:     InnerBrainOutput,
    originUser: string,
  ): Promise<void> {
    const { escalationMgr, logger } = this.opts;

    const targetUser = output.target_user ?? this.getGoalOriginUser(tempDir) ?? originUser;
    if (!targetUser) {
      logger.warn('push-loop', { event: 'block.no_target', data: { instanceId, reason: output.message } });
      return;
    }

    const blockId = randomBytes(4).toString('hex');
    logger.info('push-loop', {
      event: 'block.start_escalation',
      data: { instanceId, block_id: blockId, target_user: targetUser },
    });

    void (async () => {
      const resolution = await escalationMgr.waitForResolution({
        block_id:    blockId,
        reason:      output.message,
        question:    output.question ?? output.message,
        target_user: targetUser,
      });

      const directivesFile = path.join(tempDir, 'directives');
      const directive = JSON.stringify({
        ts:      new Date().toISOString(),
        type:    'feedback',
        content: `[BLOCK解封] 用户回复：${resolution.reply}`,
        from:    resolution.from_user,
      });
      fs.appendFileSync(directivesFile, directive + '\n', 'utf8');

      logger.info('push-loop', {
        event: 'block.resolved',
        data: { instanceId, block_id: blockId, from_thread: resolution.from_thread },
      });
    })();
  }

  private async handleComplete(
    instanceId: string,
    workDir:    string,
    output:     InnerBrainOutput,
    originUser: string,
  ): Promise<void> {
    const { logger } = this.opts;
    const targetUser = output.target_user ?? originUser;
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

    // 扫描工作目录中的产出文件（非 .brain/ 内部文件）
    const outputFiles = listWorkDirFiles(workDir);

    // 将产出文件转为附件（超过大小限制或数量上限的改为仅列文字路径）
    const attachments: MessageAttachment[] = [];
    const textOnlyFiles: string[]          = [];

    for (const rel of outputFiles) {
      const abs  = path.join(workDir, rel);
      const stat = fs.statSync(abs);
      if (attachments.length < AUTO_ATTACH_MAX_COUNT && stat.size <= AUTO_ATTACH_MAX_BYTES) {
        attachments.push({
          type: inferAttachmentType(rel),
          url:  `file://${abs}`,
          name: path.basename(rel),
          size: stat.size,
        });
      } else {
        textOnlyFiles.push(rel);
      }
    }

    const textSection = textOnlyFiles.length > 0
      ? `\n\n📁 **其他产出文件（${workDir}）：**\n${textOnlyFiles.map((f) => `  • ${f}`).join('\n')}`
      : '';

    logger.info('push-loop', {
      event: 'complete.notify',
      data: {
        target_user:  targetUser,
        thread_id:    threadId,
        instanceId,
        attachments:  attachments.length,
        text_only:    textOnlyFiles.length,
      },
    });

    await this.opts.channelRegistry.send({
      thread_id:   threadId,
      content:     `✅ 任务完成！\n\n${output.message}${textSection}`,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  }

  private async handleProgress(output: InnerBrainOutput): Promise<void> {
    this.opts.logger.info('push-loop', {
      event: 'progress',
      data: { preview: output.message.slice(0, 120) },
    });
  }

  private getGoalOriginUser(tempDir: string): string | null {
    const statusFile = path.join(tempDir, 'status');
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

    dmThreads.sort((a, b) => (b.last_msg_at ?? 0) - (a.last_msg_at ?? 0));
    const best = dmThreads[0];
    if (!best) return null;

    this.opts.logger.info('push-loop', {
      event: 'complete.thread_fallback',
      data: { target_user: userId, thread_id: best.thread_id },
    });
    return best.thread_id;
  }

  // ── offset-based 增量读取（每实例独立 offset，持久化到磁盘）─────────────

  private readNewContent(instanceId: string, tempDir: string, filePath: string): string | null {
    const stat   = fs.statSync(filePath);
    const offset = this.offsets.get(instanceId) ?? 0;
    if (stat.size <= offset) return null;

    const fd  = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(stat.size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);

    // 持久化新 offset，重启后不重复处理
    this.saveOffset(instanceId, tempDir, stat.size);

    const content = buf.toString('utf8').trim();
    return content || null;
  }
}

// ── 模块级辅助函数 ────────────────────────────────────────────────────────────

/**
 * 列出工作目录中的产出文件（排除 .brain/ 内部状态文件和 .tool-outputs/）。
 * 返回相对路径列表，方便用户直接定位。
 */
function listWorkDirFiles(workDir: string): string[] {
  const EXCLUDE_DIRS = new Set(['.brain', '.tool-outputs', 'node_modules', '.git']);
  const results: string[] = [];

  function walk(dir: string, rel: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && EXCLUDE_DIRS.has(entry.name)) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        results.push(relPath);
      }
    }
  }

  walk(workDir, '');
  return results;
}

/** 根据文件扩展名推断 MessageAttachment.type */
function inferAttachmentType(filePath: string): MessageAttachment['type'] {
  const ext = path.extname(filePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) return 'image';
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.ogg', '.m4a', '.amr'].includes(ext)) return 'audio';
  return 'file';
}

/**
 * 将 output 文件的增量内容解析为事件数组。
 *
 * 内脑每次写 output 是 `fs.appendFileSync`，多次写入后增量内容可能包含多行
 * JSON 事件（如 PROGRESS + BLOCK）。原 JSON.parse(content) 对整块内容会失败，
 * 导致 BLOCK 等关键事件被静默丢弃。
 *
 * 修复策略：按行分割，每行独立解析，非 JSON 行走文本前缀匹配。
 */
function parseInnerOutputLines(content: string): InnerBrainOutput[] {
  const lines  = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const events: InnerBrainOutput[] = [];

  for (const line of lines) {
    events.push(parseSingleLine(line));
  }

  return events.length > 0 ? events : [{ type: 'PROGRESS', message: content, ts: new Date().toISOString() }];
}

function parseSingleLine(line: string): InnerBrainOutput {
  try {
    const obj = JSON.parse(line) as Partial<InnerBrainOutput>;
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
  if (line.startsWith('[BLOCK]')) {
    const reason = line.replace('[BLOCK]', '').trim();
    return { type: 'BLOCK', message: reason, question: reason, ts };
  }
  if (line.startsWith('[COMPLETE]')) {
    return { type: 'COMPLETE', message: line.replace('[COMPLETE]', '').trim(), ts };
  }

  return { type: 'PROGRESS', message: line, ts };
}
