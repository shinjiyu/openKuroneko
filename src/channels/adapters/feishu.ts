/**
 * 飞书 Bot 频道适配器
 *
 * ── 两种接入模式 ─────────────────────────────────────────────────────────────
 *
 * 【模式 A：HTTP Webhook（需要公网 URL）】
 *   - 飞书开放平台 → 事件订阅 → 选择"将事件发送至开发者服务器"
 *   - 填写回调 URL：http://<公网IP>:8090/feishu/event
 *   - 本地开发需配合 ngrok：`ngrok http 8090`，填 HTTPS 地址
 *   - 飞书每次发送事件后等你响应，超时 3s 会重推
 *
 * 【模式 B：WebSocket 长连接（推荐，无需公网）】
 *   - 飞书开放平台 → 事件订阅 → 选择"使用长连接接收事件"
 *   - 代码主动连接飞书服务器，无需公网 IP / 域名 / HTTPS / ngrok
 *   - 配置项：mode: 'websocket'（或设置环境变量 FEISHU_MODE=websocket）
 *   - 限制：仅企业自建应用支持；集群部署时只有一个实例收到消息
 *
 * ── 消息类型支持 ──────────────────────────────────────────────────────────────
 *
 * 接收：
 *   text        纯文本（含 @mention 解析）
 *   image       图片（提取 image_key，附件方式透传）
 *   audio       语音（提取 file_key）
 *   file        文件（提取 file_key）
 *   post        富文本（提取纯文本内容）
 *   sticker     表情包（忽略）
 *
 * 发送：
 *   文本：send({ thread_id, content })
 *   图片：send({ thread_id, content, attachments: [{ type:'image', url }] })
 *   文件：send({ thread_id, content, attachments: [{ type:'file', url }] })
 *
 * ── 配置参数 ─────────────────────────────────────────────────────────────────
 *
 *   appId          飞书应用 App ID
 *   appSecret      飞书应用 App Secret
 *   verifyToken    HTTP 模式的事件验证 Token
 *   encryptKey     HTTP 模式的消息加密 Key（可选）
 *   mode           'webhook'（默认）| 'websocket'
 *   webhookPort    HTTP 模式监听端口（默认 8090）
 *   agentOpenId    本机（机器人）的 open_id，用于 @ 判断与过滤自身消息；配置后按 open_id 与 mentions 匹配（推荐）
 *   resolveUserFn  open_id → 内部 user_id 的映射函数
 *   relayUrl       消息中转服务器 WebSocket URL（可选；与 relayKey、relayAgentId 一起配置则启用）
 *   relayKey       中转鉴权 key，与服务器 RELAY_KEY 一致
 *   relayAgentId   本 agent 在中转上的标识（用于注册与广播中的 sender_agent_id）
 *   relayIngestRef  外脑注入的 { current: (threadId, userId, content, ts) => void }，收到广播时调用
 *
 * ── thread_id 格式 ───────────────────────────────────────────────────────────
 *
 *   私信：feishu:dm:<open_id>
 *   群聊：feishu:group:<chat_id>
 */

import WebSocket from 'ws';
import type { Logger } from '../../logger/index.js';
import type { ChannelAdapter, InboundMessage, OutboundMessage, MessageAttachment } from '../types.js';

/** 收到中转广播时插入群聊记录的回调（由外脑注入，current 在 ob 创建后赋值） */
export interface RelayIngestRef {
  current: ((threadId: string, userId: string, content: string, ts: number) => void) | null;
}

export interface FeishuAdapterOptions {
  appId:         string;
  appSecret:     string;
  verifyToken?:  string;
  encryptKey?:   string | undefined;
  /** 'webhook'（HTTP 回调，需公网）| 'websocket'（长连接，推荐） */
  mode?:         'webhook' | 'websocket';
  webhookPort?:  number | undefined;
  agentOpenId?:  string | undefined;
  resolveUserFn: (rawUserId: string, channelId: string) => string | null;
  /** 消息中转：URL（ws/wss）、key、本 agent 标识；与 relayIngestRef 一起由外脑注入 */
  relayUrl?:      string | undefined;
  relayKey?:     string | undefined;
  relayAgentId?: string | undefined;
  relayIngestRef?: RelayIngestRef | undefined;
  /** 可选，用于输出中转连接/注册/广播等日志 */
  relayLogger?:   Logger | undefined;
  /** 可选：传入后打 inbound/send/mention.eval 日志，便于全链路排查 */
  logger?:        {
    info:  (module: string, payload: { event: string; data?: unknown }) => void;
    debug: (module: string, payload: { event: string; data?: unknown }) => void;
  };
}

// ── 飞书事件消息体 ────────────────────────────────────────────────────────────

interface FeishuEventBody {
  /** 事件头，HTTP 推送时含 app_id（当前应用），用于与 mentions 中的 id 比对 */
  header: { event_id: string; event_type: string; create_time: string; app_id?: string };
  event: {
    message: {
      message_id:   string;
      chat_id:      string;
      chat_type:    string;   // "p2p" | "group"
      message_type: string;   // "text" | "image" | "audio" | "file" | "post" | "sticker"
      content:      string;   // JSON string，结构随 message_type 变化
      create_time:  string;
      parent_id?:   string;
      /** 被 @ 的用户用 open_id 等标识，被 @ 的机器人用 app_id 标识（id 为 app_id 字符串或含 app_id 的对象） */
      mentions?:    Array<{ id: string | { open_id?: string; app_id?: string }; key: string; name: string }>;
    };
    sender: { sender_id: { open_id: string }; sender_type: string };
  };
}

// ── 适配器 ────────────────────────────────────────────────────────────────────

export class FeishuChannelAdapter implements ChannelAdapter {
  readonly channel_id = 'feishu';
  readonly name       = '飞书 Bot';

  private readonly opts: FeishuAdapterOptions;
  private server:            import('node:http').Server | null = null;
  private tenantAccessToken: string | null = null;
  private tokenExpireAt      = 0;
  /** 启动时预取的 bot open_id（未配置 agentOpenId 时用于过滤自身消息） */
  private _botOpenId: string | null = null;
  /** 中转 WebSocket（可选） */
  private relayWs: WebSocket | null = null;
  private relayReconnectTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: FeishuAdapterOptions) {
    this.opts = { mode: 'webhook', ...opts };
  }

  async start(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    if (this.opts.mode === 'websocket') {
      await this.startWebSocket(onMessage);
    } else {
      await this.startWebhook(onMessage);
    }
    if (this.opts.relayUrl && this.opts.relayKey && this.opts.relayAgentId) {
      console.log(`[relay] 正在连接 ${this.opts.relayUrl} agent=${this.opts.relayAgentId}`);
      this.opts.relayLogger?.info('feishu', { event: 'relay.connecting', data: { url: this.opts.relayUrl, agentId: this.opts.relayAgentId } });
      this.connectRelay();
    }
  }

  // ── 发送消息 ─────────────────────────────────────────────────────────────

  async send(msg: OutboundMessage): Promise<void> {
    const token = await this.getToken();

    const parts       = msg.thread_id.split(':');
    const type        = parts[1];                        // "dm" | "group"
    const peerId      = parts.slice(2).join(':');
    const receiveIdType = type === 'group' ? 'chat_id' : 'open_id';
    const isGroup     = type === 'group';

    // 附件优先（图片、文件）
    const attachment = msg.attachments?.[0];
    let body: string;

    if (attachment?.type === 'image' && attachment.url) {
      // 先上传图片获取 image_key
      const imageKey = await this.uploadImage(attachment.url, token);
      body = JSON.stringify({
        receive_id: peerId,
        msg_type:   'image',
        content:    JSON.stringify({ image_key: imageKey }),
      });
    } else if (attachment?.type === 'file' && attachment.url) {
      const fileKey = await this.uploadFile(attachment.url, attachment.name ?? 'file', token);
      body = JSON.stringify({
        receive_id: peerId,
        msg_type:   'file',
        content:    JSON.stringify({ file_key: fileKey }),
      });
    } else {
      body = JSON.stringify({
        receive_id: peerId,
        msg_type:   'text',
        content:    JSON.stringify({ text: msg.content }),
      });
    }

    const res = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body,
        signal:  AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      throw new Error(`[feishu] send failed: ${res.status} ${await res.text()}`);
    }

    if (this.opts.logger) {
      this.opts.logger.info('feishu', {
        event: 'send',
        data: {
          thread_id:   msg.thread_id,
          content_len: msg.content?.length ?? 0,
          preview:     (msg.content ?? '').slice(0, 60),
        },
      });
    }

    // 群消息发送成功后向中转上报，供其它 agent 插入群聊记录
    if (isGroup && this.opts.relayUrl && this.opts.relayKey && this.opts.relayAgentId && this.relayWs?.readyState === 1) {
      try {
        this.relayWs.send(JSON.stringify({
          type:       'speak',
          thread_id:  msg.thread_id,
          content:    msg.content,
          ts:         Date.now(),
        }));
        console.log(`[relay] 已上报群消息 speak thread=${msg.thread_id} preview=${msg.content.slice(0, 50)}...`);
        this.opts.relayLogger?.debug('feishu', { event: 'relay.speak', data: { thread_id: msg.thread_id, preview: msg.content.slice(0, 60) } });
      } catch {
        // ignore
      }
    }
  }

  resolveUser(rawUserId: string, channelId: string): string | null {
    return this.opts.resolveUserFn(rawUserId, channelId);
  }

  async stop(): Promise<void> {
    if (this.relayReconnectTimer) {
      clearInterval(this.relayReconnectTimer);
      this.relayReconnectTimer = null;
    }
    if (this.relayWs) {
      this.relayWs.removeAllListeners();
      this.relayWs.close();
      this.relayWs = null;
    }
    await new Promise<void>((resolve) => {
      if (this.server) this.server.close(() => resolve());
      else resolve();
    });
  }

  private connectRelay(): void {
    const { relayUrl, relayKey, relayAgentId, relayIngestRef, relayLogger } = this.opts;
    if (!relayUrl || !relayKey || !relayAgentId) return;

    const ws = new WebSocket(relayUrl);
    this.relayWs = ws;

    ws.on('open', () => {
      if (this.relayReconnectTimer) {
        clearInterval(this.relayReconnectTimer);
        this.relayReconnectTimer = null;
      }
      ws.send(JSON.stringify({ type: 'register', key: relayKey, agent_id: relayAgentId }));
      console.log('[relay] 已发送 register，等待服务器确认');
      relayLogger?.info('feishu', { event: 'relay.register_sent', data: { agentId: relayAgentId } });
    });

    ws.on('message', (raw: Buffer | string) => {
      try {
        const data = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) as Record<string, unknown>;
        if (data?.type === 'registered') {
          console.log(`[relay] 已注册成功 agent_id=${data.agent_id ?? relayAgentId}`);
          relayLogger?.info('feishu', { event: 'relay.registered', data: { agentId: data.agent_id ?? relayAgentId } });
          return;
        }
        if (data?.type === 'error') {
          console.log(`[relay] 服务器返回错误: ${String((data as { message?: string }).message ?? data)}`);
          relayLogger?.warn('feishu', { event: 'relay.error', data: { message: data.message } });
          return;
        }
        if (data?.type === 'broadcast' && typeof data.thread_id === 'string' && typeof data.sender_agent_id === 'string') {
          const threadId = data.thread_id as string;
          const userId   = data.sender_agent_id as string;
          const content = typeof data.content === 'string' ? data.content : '';
          const ts      = typeof data.ts === 'number' ? data.ts : Date.now();
          relayIngestRef?.current?.(threadId, userId, content, ts);
          console.log(`[relay] 收到广播 来自=${userId} thread=${threadId} preview=${content.slice(0, 40)}...`);
          relayLogger?.debug('feishu', { event: 'relay.broadcast_ingest', data: { thread_id: threadId, sender: userId, preview: content.slice(0, 50) } });
        }
      } catch {
        // ignore malformed
      }
    });

    ws.on('close', () => {
      this.relayWs = null;
      console.log('[relay] 连接已断开，5s 后重连');
      relayLogger?.info('feishu', { event: 'relay.closed', data: {} });
      if (!this.relayReconnectTimer && relayUrl && relayKey && relayAgentId) {
        this.relayReconnectTimer = setInterval(() => this.connectRelay(), 5000);
        relayLogger?.info('feishu', { event: 'relay.reconnect_scheduled', data: { inMs: 5000 } });
      }
    });

    ws.on('error', (err) => {
      console.log(`[relay] WebSocket 错误: ${err?.message ?? err}`);
      relayLogger?.warn('feishu', { event: 'relay.error', data: { error: String(err?.message ?? err) } });
    });
  }

  // ── 模式 A：HTTP Webhook ─────────────────────────────────────────────────

  private async startWebhook(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    const http = await import('node:http');
    const port = this.opts.webhookPort ?? 8090;

    this.server = http.createServer(async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }

      let body = await readBody(req);

      // 消息加密解密
      if (this.opts.encryptKey) {
        try {
          body = await decryptFeishuBody(body, this.opts.encryptKey);
        } catch {
          res.writeHead(400); res.end('decrypt failed'); return;
        }
      }

      let parsed: unknown;
      try { parsed = JSON.parse(body); }
      catch { res.writeHead(400); res.end('invalid json'); return; }

      // URL 验证挑战
      if ((parsed as Record<string, unknown>)['type'] === 'url_verification') {
        const challenge = (parsed as Record<string, unknown>)['challenge'];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ challenge }));
        return;
      }

      // 消息去重（飞书超时重推）
      const eventId = (parsed as { header?: { event_id?: string } })?.header?.event_id;
      if (eventId && this.seenEventIds.has(eventId)) {
        res.writeHead(200); res.end('{}'); return;
      }
      if (eventId) {
        this.seenEventIds.add(eventId);
        setTimeout(() => this.seenEventIds.delete(eventId), 60_000);
      }

      try {
        const msg = await this.parseEvent(parsed as FeishuEventBody);
        if (msg) await onMessage(msg);
      } catch { /* 解析失败不影响响应 */ }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    this.server.listen(port, () => {
      console.info(`[feishu] HTTP webhook listening on :${port}/feishu/event`);
    });
  }

  // ── 模式 B：WebSocket 长连接 ─────────────────────────────────────────────

  private async startWebSocket(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    const { Client, WSClient, EventDispatcher, LoggerLevel } = await import('@larksuiteoapi/node-sdk');

    const client = new Client({
      appId:     this.opts.appId,
      appSecret: this.opts.appSecret,
      loggerLevel: LoggerLevel.info,
    });

    const dispatcher = new EventDispatcher({}).register({
      'im.message.receive_v1': async (data: unknown) => {
        // SDK 已经解包好了事件，data 是 event body
        const body = { header: {}, event: data } as unknown as FeishuEventBody;

        // WebSocket 模式下飞书 SDK 可能重复推送（重连/未 ack 重放），用 message_id 去重
        const msgId = body.event?.message?.message_id;
        if (msgId) {
          if (this.seenEventIds.has(msgId)) return;
          this.seenEventIds.add(msgId);
          setTimeout(() => this.seenEventIds.delete(msgId), 120_000);
        }

        try {
          const msg = await this.parseEvent(body);
          if (msg) await onMessage(msg);
        } catch { /* 解析失败静默 */ }
      },
      // 以下事件仅注册空处理器，避免 SDK 打出 "no ... handle" 的 warn
      'im.chat.access_event.bot_p2p_chat_entered_v1': async () => {},
      'im.message.message_read_v1': async () => {},
    });

    const wsClient = new WSClient({
      appId:     this.opts.appId,
      appSecret: this.opts.appSecret,
      loggerLevel: LoggerLevel.info,
    });

    // 保存 client 引用供 send() 使用
    this._sdkClient = client;

    // 参考 OpenClaw：启动时尝试预取 bot open_id，用于 @ 判断（失败则仅用 app_id 匹配，无需用户配置）
    await this.prefetchBotOpenId();

    wsClient.start({ eventDispatcher: dispatcher });
    console.info('[feishu] WebSocket long-connection started (no public URL needed)');
  }

  /**
   * 尝试通过飞书 API 获取当前应用（机器人）的 open_id，用于精确 @ 判断。
   * 若接口未返回或失败，仅依赖 app_id 参与 mention 匹配（飞书 @机器人 时 mention 可能带 app_id）。
   */
  private async prefetchBotOpenId(): Promise<void> {
    try {
      const token = await this.getToken();
      const res = await fetch(
        `https://open.feishu.cn/open-apis/application/v6/applications/${this.opts.appId}?lang=zh_cn`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) },
      );
      const data = (await res.json()) as { app?: { open_id?: string } };
      const openId = data?.app?.open_id;
      if (openId) {
        this._botOpenId = openId;
        console.info('[feishu] bot open_id prefetched for @-mention detection');
      }
    } catch {
      // 忽略：无 open_id 时用 app_id 参与匹配即可
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _sdkClient: any = null;

  // 已处理的事件 ID（HTTP 模式去重用）
  private readonly seenEventIds = new Set<string>();

  // ── 事件解析 ─────────────────────────────────────────────────────────────

  private async parseEvent(body: FeishuEventBody): Promise<InboundMessage | null> {
    const { message, sender } = body.event ?? {};
    if (!message) return null;

    // 过滤本 bot 自身发出的消息（与 @ 判断一致：agentOpenId / 预取 open_id / app_id）
    const selfIds = [this.opts.agentOpenId, this._botOpenId, this.opts.appId].filter(Boolean) as string[];
    if (selfIds.includes(sender.sender_id.open_id)) return null;

    const rawUserId = sender.sender_id.open_id;
    const userId    = this.opts.resolveUserFn(rawUserId, 'feishu') ?? rawUserId;

    const isGroup  = message.chat_type !== 'p2p';
    const threadId = isGroup
      ? `feishu:group:${message.chat_id}`
      : `feishu:dm:${rawUserId}`;

    // 解析消息内容（按 message_type 分发）
    const { content, attachments: rawAttachments } = parseFeishuContent(message.message_type, message.content);

    // 图片类附件：立刻下载并转为 base64 data URL，方便 LLM 多模态直接消费
    const attachments = await this.resolveAttachments(rawAttachments);

    // @mention 解析：用配置的 agentOpenId（或预取 _botOpenId）与 mentions[].id 的 open_id 匹配
    const getMentionOpenId = (id: unknown): string => {
      if (id == null) return '';
      if (typeof id === 'string') return id.trim();
      const o = id as Record<string, unknown>;
      const v = o['open_id'];
      return typeof v === 'string' ? v.trim() : '';
    };
    const rawMentions = message.mentions ?? [];
    const mentions = rawMentions.map((m) => {
      const openId = getMentionOpenId(m.id);
      if (openId) return this.opts.resolveUserFn(openId, 'feishu') ?? openId;
      return typeof m.id === 'string' ? m.id : '';
    });

    const botOpenId = (this.opts.agentOpenId ?? this._botOpenId)?.trim() ?? '';
    const mentionOpenIds = rawMentions.map((m) => getMentionOpenId(m.id));
    const isMention = botOpenId !== '' && mentionOpenIds.some((oid) => oid === botOpenId);

    if (isGroup && rawMentions.length > 0 && this.opts.logger) {
      this.opts.logger.info('feishu', {
        event: 'mention.eval',
        data: {
          thread_id:       threadId,
          bot_open_id:     botOpenId || null,
          mention_open_ids: mentionOpenIds,
          is_mention:      isMention,
          preview:         content.slice(0, 60),
        },
      });
    }

    const cleanContent = content.replace(/@\S+/g, '').trim();

    if (this.opts.logger) {
      this.opts.logger.info('feishu', {
        event: 'inbound',
        data: {
          message_id:   message.message_id,
          thread_id:    threadId,
          is_mention:   isMention,
          has_mentions: rawMentions.length,
          preview:      content.slice(0, 60),
        },
      });
    }

    return {
      id:           message.message_id,
      thread_id:    threadId,
      channel_id:   'feishu',
      user_id:      userId,
      raw_user_id:  rawUserId,
      content:      cleanContent,
      is_mention:   isMention,
      mentions,
      ts:           Number(message.create_time),
      reply_to:     message.parent_id,
      attachments,
      group_info:   isGroup ? { group_id: message.chat_id, group_name: message.chat_id } : undefined,
      sender_type:  sender.sender_type === 'user' || sender.sender_type === 'app' ? sender.sender_type : undefined,
    };
  }

  // ── Token 管理 ───────────────────────────────────────────────────────────

  private async getToken(): Promise<string> {
    if (this.tenantAccessToken && Date.now() < this.tokenExpireAt) {
      return this.tenantAccessToken;
    }
    const res  = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ app_id: this.opts.appId, app_secret: this.opts.appSecret }),
        signal:  AbortSignal.timeout(10_000),
      },
    );
    const data = (await res.json()) as { tenant_access_token: string; expire: number };
    this.tenantAccessToken = data.tenant_access_token;
    this.tokenExpireAt     = Date.now() + data.expire * 1000 - 60_000;
    return this.tenantAccessToken;
  }

  // ── 附件解析：feishu-image:// → data URL ─────────────────────────────────

  /**
   * 将 parseFeishuContent 返回的 `feishu-image://` / `feishu-file://` 附件
   * 转换为可直接被 LLM 消费的 data URL（图片）或本地可读路径（文件）。
   *
   * 仅处理图片类型；文件/音频保留原始 URL，由下游按需处理。
   */
  private async resolveAttachments(attachments: MessageAttachment[]): Promise<MessageAttachment[]> {
    const results: MessageAttachment[] = [];
    for (const att of attachments) {
      if (att.type === 'image' && att.url?.startsWith('feishu-image://')) {
        const imageKey = att.url.slice('feishu-image://'.length);
        try {
          const token  = await this.getToken();
          const res    = await fetch(
            `https://open.feishu.cn/open-apis/im/v1/images/${imageKey}?type=message`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
          );
          if (res.ok) {
            const buf    = await res.arrayBuffer();
            const mime   = res.headers.get('content-type') ?? 'image/jpeg';
            const b64    = Buffer.from(buf).toString('base64');
            results.push({ ...att, url: `data:${mime};base64,${b64}` });
          } else {
            results.push(att); // 下载失败时保留原始引用
          }
        } catch {
          results.push(att);
        }
      } else {
        results.push(att);
      }
    }
    return results;
  }

  // ── 图片/文件上传 ─────────────────────────────────────────────────────────

  /** 读取文件内容：支持 file:// 本地路径和 HTTP(S) URL */
  private async fetchBytes(url: string): Promise<ArrayBuffer> {
    if (url.startsWith('file://')) {
      const localPath = url.slice('file://'.length);
      const buf = (await import('fs')).readFileSync(localPath);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    return res.arrayBuffer();
  }

  private async uploadImage(url: string, token: string): Promise<string> {
    const imgData = await this.fetchBytes(url);
    const name    = url.startsWith('file://') ? url.split('/').pop() ?? 'image.png' : 'image.png';

    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', new Blob([imgData]), name);

    const res = await fetch('https://open.feishu.cn/open-apis/im/v1/images', {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` },
      body:    form,
      signal:  AbortSignal.timeout(30_000),
    });
    const data = (await res.json()) as { data: { image_key: string } };
    return data.data.image_key;
  }

  private async uploadFile(url: string, fileName: string, token: string): Promise<string> {
    const fileData = await this.fetchBytes(url);

    const form = new FormData();
    form.append('file_type', 'stream');
    form.append('file_name', fileName);
    form.append('file', new Blob([fileData]), fileName);

    const res = await fetch('https://open.feishu.cn/open-apis/im/v1/files', {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` },
      body:    form,
      signal:  AbortSignal.timeout(30_000),
    });
    const data = (await res.json()) as { data: { file_key: string } };
    return data.data.file_key;
  }
}

// ── 消息内容解析 ──────────────────────────────────────────────────────────────

function parseFeishuContent(
  msgType: string,
  contentStr: string,
): { content: string; attachments: MessageAttachment[] } {
  const empty = { content: '', attachments: [] as MessageAttachment[] };

  try {
    const obj = JSON.parse(contentStr) as Record<string, unknown>;

    switch (msgType) {
      case 'text':
        return { content: (obj['text'] as string | undefined) ?? '', attachments: [] };

      case 'image': {
        const imageKey = obj['image_key'] as string | undefined;
        return {
          content: '[图片]',
          attachments: imageKey
            ? [{ type: 'image', url: `feishu-image://${imageKey}`, name: imageKey }]
            : [],
        };
      }

      case 'audio': {
        const fileKey = obj['file_key'] as string | undefined;
        return {
          content: '[语音]',
          attachments: fileKey
            ? [{ type: 'file', url: `feishu-file://${fileKey}`, name: fileKey }]
            : [],
        };
      }

      case 'file': {
        const fileKey  = obj['file_key']  as string | undefined;
        const fileName = obj['file_name'] as string | undefined;
        return {
          content: `[文件${fileName ? ': ' + fileName : ''}]`,
          attachments: fileKey
            ? [{ type: 'file', url: `feishu-file://${fileKey}`, name: fileName ?? fileKey }]
            : [],
        };
      }

      case 'post': {
        // 富文本：提取所有 text 节点
        const zh = (obj['zh_cn'] ?? obj['en_us'] ?? obj) as {
          title?: string;
          content?: unknown[][];
        };
        const lines: string[] = [];
        if (zh.title) lines.push(zh.title);
        for (const row of zh.content ?? []) {
          const rowText = row
            .filter((el): el is { tag: string; text?: string } => typeof el === 'object')
            .map((el) => (el.tag === 'text' ? el.text ?? '' : el.tag === 'at' ? '@' : ''))
            .join('');
          if (rowText) lines.push(rowText);
        }
        return { content: lines.join('\n'), attachments: [] };
      }

      case 'sticker':
        return { content: '[表情]', attachments: [] };

      default:
        return { content: contentStr, attachments: [] };
    }
  } catch {
    return empty;
  }
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * 飞书 Encrypt Key AES-CBC-256 解密
 * 飞书加密格式：Base64(AES256CBC(payload))，Key = SHA256(encryptKey)
 */
async function decryptFeishuBody(body: string, encryptKey: string): Promise<string> {
  const crypto = await import('node:crypto');
  const parsed = JSON.parse(body) as { encrypt?: string };
  if (!parsed.encrypt) return body;

  const keyHash  = crypto.createHash('sha256').update(encryptKey).digest();
  const cipherBuf = Buffer.from(parsed.encrypt, 'base64');
  const iv       = cipherBuf.subarray(0, 16);
  const data     = cipherBuf.subarray(16);

  const decipher = crypto.createDecipheriv('aes-256-cbc', keyHash, iv);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}
