/**
 * 飞书 Bot 频道适配器（Stub）
 *
 * 接口完整预留，实现 ChannelAdapter 协议。
 * 接入时需配置：
 *   FEISHU_APP_ID       飞书应用 App ID
 *   FEISHU_APP_SECRET   飞书应用 App Secret
 *   FEISHU_VERIFY_TOKEN 事件验证 Token
 *   FEISHU_ENCRYPT_KEY  消息加密 Key（可选）
 *   FEISHU_WEBHOOK_PORT 本地 Webhook 监听端口（默认 8090）
 *
 * 飞书 Bot 事件订阅模式（推荐）：
 *   1. 在飞书开放平台创建应用，启用"机器人"能力
 *   2. 配置事件订阅，回调地址指向本服务 /feishu/event
 *   3. 订阅事件：im.message.receive_v1（消息）
 *   4. 订阅事件：im.chat.member.bot.added_v1（入群）
 *
 * 参考文档：https://open.feishu.cn/document/home/develop-a-bot-in-5-minutes/create-an-app
 *
 * thread_id 格式：
 *   私信：feishu:dm:<open_id>
 *   群聊：feishu:group:<chat_id>
 */

import type { ChannelAdapter, InboundMessage, OutboundMessage } from '../types.js';

export interface FeishuAdapterOptions {
  appId: string;
  appSecret: string;
  verifyToken: string;
  encryptKey?: string | undefined;
  webhookPort?: number | undefined;

  /**
   * 解析平台 open_id → 统一 user_id 的函数。
   * 由外部 UserStore 提供，此处注入以避免循环依赖。
   */
  resolveUserFn: (rawUserId: string, channelId: string) => string | null;

  /** agent 自身的飞书 open_id，用于过滤自身消息和识别 @mention */
  agentOpenId?: string | undefined;
}

// 飞书事件消息体（简化，仅列出本实现需要的字段）
interface FeishuEventBody {
  header: { event_id: string; event_type: string; create_time: string };
  event: {
    message: {
      message_id: string;
      chat_id: string;
      chat_type: string; // "p2p" | "group"
      content: string;   // JSON string
      create_time: string;
      parent_id?: string;
      mentions?: Array<{ id: { open_id: string }; key: string }>;
    };
    sender: { sender_id: { open_id: string }; sender_type: string };
  };
}

export class FeishuChannelAdapter implements ChannelAdapter {
  readonly channel_id = 'feishu';
  readonly name = '飞书 Bot';

  private readonly opts: FeishuAdapterOptions;
  private server: import('node:http').Server | null = null;
  private tenantAccessToken: string | null = null;
  private tokenExpireAt = 0;

  constructor(opts: FeishuAdapterOptions) {
    this.opts = opts;
  }

  async start(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    // 动态 import http，仅在使用时加载
    const http = await import('node:http');
    const port = this.opts.webhookPort ?? 8090;

    this.server = http.createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
      }

      const body = await readBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end('invalid json');
        return;
      }

      // 飞书挑战验证（首次配置时）
      if ((parsed as Record<string, unknown>)['type'] === 'url_verification') {
        const challenge = (parsed as Record<string, unknown>)['challenge'];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ challenge }));
        return;
      }

      // 解析并路由消息
      try {
        const msg = this.parseEvent(parsed as FeishuEventBody);
        if (msg) {
          await onMessage(msg);
        }
      } catch (e) {
        // 解析失败不影响 HTTP 响应
        console.error('[feishu-adapter] parse error:', e);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    this.server.listen(port, () => {
      console.info(`[feishu-adapter] listening on :${port}`);
    });
  }

  async send(msg: OutboundMessage): Promise<void> {
    const token = await this.getToken();

    // 从 thread_id 提取飞书 chat_id 或 open_id
    // feishu:dm:<open_id>    → 私信，receive_id_type = open_id
    // feishu:group:<chat_id> → 群聊，receive_id_type = chat_id
    const parts = msg.thread_id.split(':');
    const type   = parts[1]; // "dm" | "group"
    const peerId = parts.slice(2).join(':');
    const receiveIdType = type === 'group' ? 'chat_id' : 'open_id';

    const body = JSON.stringify({
      receive_id: peerId,
      msg_type: 'text',
      content: JSON.stringify({ text: msg.content }),
    });

    const res = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!res.ok) {
      throw new Error(`[feishu-adapter] send failed: ${res.status} ${await res.text()}`);
    }
  }

  resolveUser(rawUserId: string, channelId: string): string | null {
    return this.opts.resolveUserFn(rawUserId, channelId);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // ── 私有：事件解析 ────────────────────────────────────────────────────────

  private parseEvent(body: FeishuEventBody): InboundMessage | null {
    if (!body?.event?.message) return null;

    const { message, sender } = body.event;

    // 过滤 bot 自身发出的消息
    if (
      this.opts.agentOpenId &&
      sender.sender_id.open_id === this.opts.agentOpenId
    ) {
      return null;
    }

    const rawUserId = sender.sender_id.open_id;
    const userId = this.opts.resolveUserFn(rawUserId, 'feishu') ?? rawUserId;

    const isGroup = message.chat_type !== 'p2p';
    const threadId = isGroup
      ? `feishu:group:${message.chat_id}`
      : `feishu:dm:${rawUserId}`;

    // 解析文本内容
    let content = '';
    try {
      const parsed = JSON.parse(message.content) as Record<string, unknown>;
      content = (parsed['text'] as string | undefined) ?? '';
    } catch {
      content = message.content;
    }

    // 识别 @mention
    const mentions = (message.mentions ?? []).map(
      (m) => this.opts.resolveUserFn(m.id.open_id, 'feishu') ?? m.id.open_id,
    );
    const isMention = this.opts.agentOpenId
      ? (message.mentions ?? []).some((m) => m.id.open_id === this.opts.agentOpenId)
      : content.includes('@');

    // 清理 @mention 标记
    const cleanContent = content
      .replace(/@\S+/g, '')
      .trim();

    return {
      id: message.message_id,
      thread_id: threadId,
      channel_id: 'feishu',
      user_id: userId,
      raw_user_id: rawUserId,
      content: cleanContent,
      is_mention: isMention,
      mentions,
      ts: Number(message.create_time),
      reply_to: message.parent_id,
      group_info: isGroup
        ? { group_id: message.chat_id, group_name: message.chat_id }
        : undefined,
    };
  }

  // ── 私有：Token 管理 ──────────────────────────────────────────────────────

  private async getToken(): Promise<string> {
    if (this.tenantAccessToken && Date.now() < this.tokenExpireAt) {
      return this.tenantAccessToken;
    }

    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: this.opts.appId,
        app_secret: this.opts.appSecret,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await res.json()) as { tenant_access_token: string; expire: number };
    this.tenantAccessToken = data.tenant_access_token;
    this.tokenExpireAt = Date.now() + data.expire * 1000 - 60_000; // 提前 60s 刷新
    return this.tenantAccessToken;
  }
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
