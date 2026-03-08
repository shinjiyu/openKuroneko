/**
 * CLI 频道适配器
 *
 * 通过文件模拟 DM 对话：
 *   input 文件  → 读取用户输入（offset 消费语义，兼容内脑文件协议）
 *   output 文件 → 写外脑回复
 *
 * thread_id: "cli:dm:local"
 * user_id:   "local"（配置中可覆盖）
 */

import fs from 'node:fs';
import type { ChannelAdapter, InboundMessage, OutboundMessage } from '../types.js';

export interface CliAdapterOptions {
  /** 读取用户输入的文件路径 */
  inputPath: string;
  /** 写外脑回复的文件路径 */
  outputPath: string;
  /** 轮询间隔（ms），默认 1000 */
  pollMs?: number;
  /** 覆盖 user_id，默认 "local" */
  userId?: string;
}

const THREAD_ID = 'cli:dm:local';

export class CliChannelAdapter implements ChannelAdapter {
  readonly channel_id = 'cli';
  readonly name = 'CLI (local file)';

  private readonly inputPath: string;
  private readonly outputPath: string;
  private readonly pollMs: number;
  private readonly userId: string;

  private offsetFile: string;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: CliAdapterOptions) {
    this.inputPath   = opts.inputPath;
    this.outputPath  = opts.outputPath;
    this.pollMs      = opts.pollMs ?? 1000;
    this.userId      = opts.userId ?? 'local';
    this.offsetFile  = `${this.inputPath}.ob.offset`; // outer-brain 专用 offset
  }

  async start(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    this.pollTimer = setInterval(async () => {
      const content = this.readNewContent();
      if (!content) return;

      const msg: InboundMessage = {
        id: `cli-${Date.now()}`,
        thread_id: THREAD_ID,
        channel_id: 'cli',
        user_id: this.userId,
        raw_user_id: this.userId,
        content,
        is_mention: false,
        mentions: [],
        ts: Date.now(),
      };

      await onMessage(msg);
    }, this.pollMs);
  }

  async send(msg: OutboundMessage): Promise<void> {
    let line = `[外脑] ${msg.content}\n`;
    if (msg.attachments && msg.attachments.length > 0) {
      const attachLines = msg.attachments
        .map((a) => {
          const loc = a.url?.startsWith('file://') ? a.url.slice('file://'.length) : (a.url ?? '');
          return `  📎 [${a.type}] ${a.name ?? loc}${loc && loc !== a.name ? `\n     路径: ${loc}` : ''}`;
        })
        .join('\n');
      line += `[附件]\n${attachLines}\n`;
    }
    fs.appendFileSync(this.outputPath, line, 'utf8');
  }

  resolveUser(_rawUserId: string, _channelId: string): string | null {
    return this.userId;
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ── 私有：offset-based 增量读取 ──────────────────────────────────────────

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

  private readNewContent(): string | null {
    if (!fs.existsSync(this.inputPath)) return null;
    const stat = fs.statSync(this.inputPath);
    const offset = this.readOffset();
    if (stat.size <= offset) return null;

    const fd  = fs.openSync(this.inputPath, 'r');
    const buf = Buffer.alloc(stat.size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    this.writeOffset(stat.size);

    const content = buf.toString('utf8').trim();
    return content || null;
  }
}
