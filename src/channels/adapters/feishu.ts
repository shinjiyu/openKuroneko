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
 *   agentUnionId   本机（机器人）的 union_id，用于过滤自身消息与 @ 判定（与 sender/mentions 的 union_id 匹配）；必配
 *   onFeishuIdsSeen  收到事件时写入 open_id ↔ union_id 映射（用于 getOpenIdForUnionId）
 *   getOpenIdForUnionId  union_id → 本应用 open_id，发私信 API 时使用
 *   resolveUserFn  open_id → 内部 user_id 的映射函数
 *   relayUrl       消息中转服务器 WebSocket URL（可选；与 relayKey、relayAgentId 一起配置则启用）
 *   relayKey       中转鉴权 key，与服务器 RELAY_KEY 一致
 *   relayAgentId   本 agent 在中转上的标识（用于注册与广播中的 sender_agent_id）
 *   relayIngestRef  外脑注入的 { current: (threadId, userId, content, ts) => void }，收到广播时调用
 *
 * ── thread_id 格式 ───────────────────────────────────────────────────────────
 *
 *   私信：feishu:dm:<canonical_user_id>（有 union_id 时为 union_id，否则为 open_id）
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
  /** 本机（机器人）的 union_id，用于过滤自身消息与 @ 判定（必配） */
  agentUnionId?:  string | undefined;
  resolveUserFn: (rawUserId: string, channelId: string) => string | null;
  /** 用 union_id 查本应用下 open_id（DM 发消息时需将 thread 的 union_id 解析为 open_id） */
  getOpenIdForUnionId?: (unionId: string) => string | null;
  /** 收到事件后合并 open_id/union_id/name 到映射表（用于维护 union_id↔open_id） */
  onFeishuIdsSeen?: (entries: Array<{ openId: string; unionId?: string; name?: string }>) => void;
  /** 按 open_id 或 union_id 查展示名（用于入站消息的 sender_name，由 FeishuOpenIdMap.getDisplayName 提供） */
  getFeishuDisplayName?: (openIdOrUnionId: string) => string | undefined;
  /** 是否解析发送方展示名（调飞书 contact API，有配额消耗；默认 true） */
  resolveSenderNames?: boolean;
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
      /** 被 @ 的用户/机器人；id 可能含 open_id、union_id、app_id（飞书会带 union_id 时需对应权限） */
      mentions?:    Array<{ id: string | { open_id?: string; union_id?: string; app_id?: string }; key: string; name: string }>;
    };
    sender: { sender_id: { open_id: string; union_id?: string }; sender_type: string };
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
  /** 启动时预取的 bot open_id（sender 无 union_id 时用于过滤自身消息，以及 @ 的 open_id 匹配） */
  private _botOpenId: string | null = null;
  /** 启动时预取的 bot 展示名（来自飞书应用信息，用于覆盖 soul.name、供 agent 区分「自己」） */
  private _botDisplayName: string | null = null;
  /** 中转 WebSocket（可选） */
  private relayWs: WebSocket | null = null;
  private relayReconnectTimer: ReturnType<typeof setInterval> | null = null;
  /** 发送方展示名缓存（open_id → { name, expireAt }），减少 contact API 调用 */
  private readonly senderNameCache = new Map<string, { name: string; expireAt: number }>();
  private static readonly SENDER_NAME_TTL_MS = 10 * 60 * 1000;

  constructor(opts: FeishuAdapterOptions) {
    this.opts = { mode: 'webhook', ...opts };
  }

  async start(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    // 先启动 relay 连接（与飞书并行），避免等飞书 WebSocket/prefetch 完成才连 relay 导致首条群回复赶不上
    if (this.opts.relayUrl && this.opts.relayKey && this.opts.relayAgentId) {
      console.log(`[relay] 正在连接 ${this.opts.relayUrl} agent=${this.opts.relayAgentId}`);
      this.opts.relayLogger?.info('feishu', { event: 'relay.connecting', data: { url: this.opts.relayUrl, agentId: this.opts.relayAgentId } });
      this.connectRelay();
    }
    if (this.opts.mode === 'websocket') {
      await this.startWebSocket(onMessage);
    } else {
      await this.startWebhook(onMessage);
    }
  }

  // ── 发送消息 ─────────────────────────────────────────────────────────────

  async send(msg: OutboundMessage): Promise<void> {
    const token = await this.getToken();

    const parts  = msg.thread_id.split(':');
    const type  = parts[1];                   // "dm" | "group"
    let peerId  = parts.slice(2).join(':');
    const isGroup = type === 'group';

    // DM 时 peerId 可能为 union_id（on_xxx），需解析为本应用 open_id 再调 API
    let receiveIdType: 'chat_id' | 'open_id' | 'union_id' = type === 'group' ? 'chat_id' : 'open_id';
    if (!isGroup && peerId.startsWith('on_') && this.opts.getOpenIdForUnionId) {
      const openId = this.opts.getOpenIdForUnionId(peerId);
      if (openId) {
        peerId = openId;
        receiveIdType = 'open_id';
      } else {
        receiveIdType = 'union_id';
      }
    }

    const replyToMessageId = msg.reply_to?.trim() || undefined;
    const attachments = msg.attachments ?? [];

    const sendOne = async (payload: { content: string; msg_type: string }, useReply?: string): Promise<void> => {
      let res: Response;
      if (useReply) {
        res = await fetch(
          `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(useReply)}/reply`,
          {
            method:  'POST',
            headers:  { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body:     JSON.stringify(payload),
            signal:   AbortSignal.timeout(15_000),
          },
        );
      } else {
        res = await fetch(
          `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
          {
            method:  'POST',
            headers:  { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body:     JSON.stringify({ receive_id: peerId, ...payload }),
            signal:   AbortSignal.timeout(15_000),
          },
        );
      }
      if (!res.ok) throw new Error(`[feishu] send failed: ${res.status} ${await res.text()}`);
    };

    // 1) 先发文本（有内容或仅附件时发一条占位/说明）
    const textPayload = {
      msg_type: 'text',
      content:  JSON.stringify({ text: (msg.content ?? '').trim() || ' ' }),
    };
    await sendOne(textPayload, replyToMessageId);

    // 2) 再按顺序发每条附件（多附件：每条一条消息）
    for (const att of attachments) {
      if (att.type === 'image' && att.url) {
        const imageKey = await this.uploadImage(att.url, token);
        await sendOne({ msg_type: 'image', content: JSON.stringify({ image_key: imageKey }) });
      } else if ((att.type === 'file' || att.type === 'audio' || att.type === 'video') && att.url) {
        const fileKey = await this.uploadFile(att.url, att.name ?? 'file', token);
        await sendOne({ msg_type: 'file', content: JSON.stringify({ file_key: fileKey }) });
      }
    }

    if (this.opts.logger) {
      this.opts.logger.info('feishu', {
        event: 'send',
        data: {
          thread_id:     msg.thread_id,
          content_len:   (msg.content ?? '').length,
          attachments:   attachments.length,
          preview:       (msg.content ?? '').slice(0, 60),
        },
      });
    }

    // 群消息发送成功后向中转上报，供其它 agent 插入群聊记录
    const relayReady = this.opts.relayUrl && this.opts.relayKey && this.opts.relayAgentId && this.relayWs?.readyState === 1;
    if (isGroup && this.opts.relayUrl && this.opts.relayKey && this.opts.relayAgentId) {
      if (relayReady) {
        try {
          this.relayWs!.send(JSON.stringify({
            type:       'speak',
            thread_id:  msg.thread_id,
            content:    msg.content,
            ts:         Date.now(),
          }));
          this.opts.relayLogger?.info('feishu', { event: 'relay.speak', data: { thread_id: msg.thread_id, preview: (msg.content ?? '').slice(0, 60) } });
        } catch (e) {
          this.opts.relayLogger?.warn('feishu', { event: 'relay.speak_error', data: { thread_id: msg.thread_id, error: String(e) } });
        }
      } else {
        this.opts.relayLogger?.info('feishu', {
          event: 'relay.speak_skipped',
          data: { thread_id: msg.thread_id, reason: this.relayWs == null ? 'ws_not_created' : `ws_state_${this.relayWs.readyState}` },
        });
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
    await this.prefetchBotInfo();
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

      this.logRawSdkEvent((parsed as FeishuEventBody)?.event, 'webhook');

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
        // SDK 底层：记录收到的最原始 event 结构（content 截断，避免 base64 等撑爆日志）
        this.logRawSdkEvent(data, 'ws');

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

    // 启动时预取 bot open_id 与展示名
    await this.prefetchBotInfo();

    wsClient.start({ eventDispatcher: dispatcher });
    console.info('[feishu] WebSocket long-connection started (no public URL needed)');
  }

  /**
   * 通过飞书 API 获取当前应用（机器人）的 open_id 与展示名。
   * 用于：精确 @ 判断、覆盖 soul 中的名字、让 agent 区分「自己」与「当前用户」。
   */
  private async prefetchBotInfo(): Promise<void> {
    try {
      const token = await this.getToken();
      const res = await fetch(
        `https://open.feishu.cn/open-apis/application/v6/applications/${this.opts.appId}?lang=zh_cn`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) },
      );
      const data = (await res.json()) as {
        app?: { open_id?: string; name?: string; app_name?: string; display_name?: string };
      };
      const app = data?.app;
      if (app?.open_id) {
        this._botOpenId = app.open_id;
        console.info('[feishu] bot open_id prefetched (self-filter fallback and @-mention)');
      }
      const name = app?.name ?? app?.app_name ?? app?.display_name;
      if (typeof name === 'string' && name.trim()) {
        this._botDisplayName = name.trim();
        console.info('[feishu] bot display name prefetched (overrides soul.name for identity)', this._botDisplayName);
      }
    } catch {
      // 忽略：无 open_id 时用 app_id 参与匹配即可；无 name 时用 soul.name
    }
  }

  /** 返回飞书侧机器人展示名（若已预取），用于覆盖 soul.name、供 agent 区分「自己」 */
  getBotDisplayName(): string | undefined {
    return this._botDisplayName ?? undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _sdkClient: any = null;

  // 已处理的事件 ID（HTTP 模式去重用）
  private readonly seenEventIds = new Set<string>();

  /**
   * 在 SDK 底层打原始 event 日志，便于查看飞书下发的完整数据结构（如 mentions 格式）。
   * content 截断至 800 字符，避免 base64 等撑爆日志。
   */
  private logRawSdkEvent(eventPayload: unknown, source: 'ws' | 'webhook'): void {
    if (!this.opts.logger) return;
    const raw = eventPayload as Record<string, unknown> | null | undefined;
    if (!raw || typeof raw !== 'object') {
      this.opts.logger.info('feishu', { event: 'sdk.raw_receive', data: { source, raw: eventPayload } });
      return;
    }
    const message = raw['message'] as Record<string, unknown> | undefined;
    let safeRaw: Record<string, unknown> = { ...raw };
    if (message && typeof message === 'object') {
      const content = message['content'];
      const truncated =
        typeof content === 'string'
          ? content.length > 800
            ? content.slice(0, 800) + '...[truncated ' + (content.length - 800) + ' chars]'
            : content
          : content;
      safeRaw = { ...raw, message: { ...message, content: truncated } };
    }
    this.opts.logger.info('feishu', {
      event: 'sdk.raw_receive',
      data: { source, raw: safeRaw },
    });
  }

  // ── 事件解析 ─────────────────────────────────────────────────────────────

  private async parseEvent(body: FeishuEventBody): Promise<InboundMessage | null> {
    const { message, sender } = body.event ?? {};
    if (!message) return null;

    const senderOpenId = sender.sender_id.open_id;
    const senderUnionId = (sender.sender_id as { union_id?: string }).union_id?.trim();

    // 过滤本 bot 自身发出的消息：优先 union_id，无 union_id 时用预取的 _botOpenId
    const isSelf =
      (this.opts.agentUnionId && senderUnionId === this.opts.agentUnionId.trim()) ||
      (this._botOpenId !== null && senderOpenId === this._botOpenId);
    if (isSelf) return null;

    // 从事件中抽取 open_id / union_id / name，写入映射表（内部以 union_id 为主 id 时需维护 union_id↔open_id）
    const getIdParts = (id: unknown): { openId: string; unionId?: string } => {
      if (id == null) return { openId: '' };
      if (typeof id === 'string') return { openId: id.trim() };
      const o = id as Record<string, unknown>;
      const openId = typeof o['open_id'] === 'string' ? (o['open_id'] as string).trim() : '';
      const unionId = typeof o['union_id'] === 'string' ? (o['union_id'] as string).trim() : undefined;
      return unionId === undefined ? { openId } : { openId, unionId };
    };
    const idEntries: Array<{ openId: string; unionId?: string; name?: string }> = [
      senderUnionId === undefined ? { openId: senderOpenId } : { openId: senderOpenId, unionId: senderUnionId },
    ];
    const rawMentions = message.mentions ?? [];
    for (const m of rawMentions) {
      const { openId, unionId } = getIdParts(m.id);
      if (openId) {
        const name = (m as { name?: string }).name?.trim();
        idEntries.push({ openId, ...(unionId !== undefined && { unionId }), ...(name !== undefined && name !== '' && { name }) });
      }
    }
    // 缺名的条目用飞书 contact API 解析展示名（可关闭以省配额）
    if (this.opts.resolveSenderNames !== false) {
      for (const e of idEntries) {
        if (e.openId && !e.name) {
          const name = await this.resolveFeishuUserName(e.openId);
          if (name) e.name = name;
        }
      }
    }
    this.opts.onFeishuIdsSeen?.(idEntries);

    // 内部以 union_id 为主 id：有 union_id 用 union_id，否则回退 open_id
    const canonicalSenderId = senderUnionId || senderOpenId;
    const userId = this.opts.resolveUserFn(canonicalSenderId, 'feishu') ?? canonicalSenderId;

    const isGroup = message.chat_type !== 'p2p';
    const threadId = isGroup
      ? `feishu:group:${message.chat_id}`
      : `feishu:dm:${canonicalSenderId}`;

    // 解析消息内容（post 时传入 rawMentions，at 按顺序用 key 占位供 normalizeMentions 替换）
    const { content, attachments: rawAttachments } = parseFeishuContent(
      message.message_type,
      message.content,
      rawMentions,
    );

    // 图片类附件：立刻下载并转为 base64 data URL，方便 LLM 多模态直接消费
    const attachments = await this.resolveAttachments(rawAttachments);

    // @mention 解析：内部统一用 union_id（有则用，无则 open_id）
    const mentions = rawMentions.map((m) => {
      const { openId, unionId } = getIdParts(m.id);
      const canonical = unionId || openId;
      if (canonical) return this.opts.resolveUserFn(canonical, 'feishu') ?? canonical;
      return typeof m.id === 'string' ? m.id : '';
    });

    // Agent 自我识别：union_id 配置 + 预取 open_id（mentions 可能只带其一）
    const botOpenId = this._botOpenId?.trim() ?? '';
    const botUnionId = this.opts.agentUnionId?.trim() ?? '';
    const mentionOpenIds = rawMentions.map((m) => getIdParts(m.id).openId);
    const mentionUnionIds = rawMentions.map((m) => getIdParts(m.id).unionId).filter(Boolean) as string[];
    const isMention =
      (botOpenId !== '' && mentionOpenIds.some((oid) => oid === botOpenId)) ||
      (botUnionId !== '' && mentionUnionIds.some((uid) => uid === botUnionId));

    if (isGroup && rawMentions.length > 0 && this.opts.logger) {
      this.opts.logger.info('feishu', {
        event: 'mention.eval',
        data: {
          thread_id:        threadId,
          bot_open_id:      botOpenId || null,
          bot_union_id:     botUnionId || null,
          mention_open_ids: mentionOpenIds,
          mention_union_ids: mentionUnionIds,
          is_mention:       isMention,
          preview:          content.slice(0, 60),
        },
      });
    }

    // 将 @ key 替换为 <at user_id="open_id">显示名</at>，机器人自己的 @ 替换为空（参考 OpenClaw）
    const nameByOpenId = new Map<string, string>();
    for (const e of idEntries) {
      if (e.openId && e.name) nameByOpenId.set(e.openId, e.name);
    }
    const normalizedContent = normalizeMentions(
      content,
      rawMentions,
      botOpenId,
      botUnionId,
      getIdParts,
      (openId, fallback) => nameByOpenId.get(openId) ?? this.opts.getFeishuDisplayName?.(openId) ?? fallback ?? openId,
    );

    const senderName =
      this.opts.getFeishuDisplayName?.(canonicalSenderId) ?? undefined;

    if (this.opts.logger) {
      this.opts.logger.info('feishu', {
        event: 'inbound',
        data: {
          message_id:   message.message_id,
          thread_id:    threadId,
          is_mention:   isMention,
          has_mentions: rawMentions.length,
          sender_name:  senderName ?? null,
          user_id:      userId,
          preview:      content.slice(0, 60),
        },
      });
    }

    return {
      id:           message.message_id,
      thread_id:    threadId,
      channel_id:   'feishu',
      user_id:      userId,
      raw_user_id:  senderOpenId,
      sender_name:  senderName,
      content:      normalizedContent,
      is_mention:   isMention,
      mentions,
      ts:           Number(message.create_time),
      reply_to:     message.parent_id,
      attachments,
      group_info:   isGroup ? { group_id: message.chat_id, group_name: message.chat_id } : undefined,
      sender_type:  sender.sender_type === 'user' || sender.sender_type === 'app' ? sender.sender_type : undefined,
      ...(await this.fetchQuotedContent(message.parent_id)),
    };
  }

  /**
   * 拉取被引用消息正文（parent_id），供 agent 看到「回复自」内容。失败或已撤回时返回空对象。
   */
  private async fetchQuotedContent(parentId: string | undefined): Promise<{ quoted_content?: string }> {
    if (!parentId?.trim()) return {};
    try {
      const text = await this.getMessageContent(parentId.trim());
      if (text?.trim()) return { quoted_content: text.trim() };
    } catch (e) {
      if (this.opts.logger) {
        this.opts.logger.debug('feishu', {
          event: 'quoted.fetch_failed',
          data: { parent_id: parentId, error: String(e) },
        });
      }
    }
    return {};
  }

  /**
   * 根据 message_id 拉取单条消息正文（用于引用回复场景）。撤回或不可见时返回 null。
   */
  private async getMessageContent(messageId: string): Promise<string | null> {
    const token = await this.getToken();
    const res = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal:  AbortSignal.timeout(8000),
      },
    );
    const data = (await res.json()) as {
      code?: number;
      data?: {
        items?: Array<{ body?: { content?: string }; msg_type?: string; deleted?: boolean }>;
        body?: { content?: string };
        msg_type?: string;
        deleted?: boolean;
      };
    };
    if (data.code !== 0) return null;
    const raw = data.data?.items?.[0] ?? data.data;
    if (!raw || raw.deleted) return null;
    const msgType = raw.msg_type ?? 'text';
    const contentStr = (raw as { body?: { content?: string } }).body?.content ?? '';
    const { content } = parseFeishuContent(msgType, contentStr);
    return content?.trim() ? content : null;
  }

  /**
   * 通过飞书 contact/v3/users 解析 open_id 对应展示名，带 10 分钟内存缓存。
   * 需应用具备 contact:user.base:readonly 等权限，否则返回 undefined。
   */
  private async resolveFeishuUserName(openId: string): Promise<string | undefined> {
    const key = openId.trim();
    if (!key) return undefined;
    const now = Date.now();
    const cached = this.senderNameCache.get(key);
    if (cached && cached.expireAt > now) return cached.name;
    try {
      const token = await this.getToken();
      const res = await fetch(
        `https://open.feishu.cn/open-apis/contact/v3/users/${encodeURIComponent(key)}?user_id_type=open_id`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal:  AbortSignal.timeout(5000),
        },
      );
      const data = (await res.json()) as {
        data?: { user?: { name?: string; display_name?: string; nickname?: string; en_name?: string } };
        code?: number;
      };
      if (data?.data?.user) {
        const u = data.data.user;
        const name = u.name ?? u.display_name ?? u.nickname ?? u.en_name;
        if (typeof name === 'string' && name.trim()) {
          this.senderNameCache.set(key, { name: name.trim(), expireAt: now + FeishuChannelAdapter.SENDER_NAME_TTL_MS });
          return name.trim();
        }
      }
    } catch {
      // 权限不足或网络失败时静默，不阻塞消息处理
    }
    return undefined;
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

// ── @ 提及归一化（参考 OpenClaw normalizeMentions）────────────────────────────────
// 将正文中的 mention key（如 @_user_1）替换为 <at user_id="open_id">显示名</at>，便于 LLM 知道 @ 了谁；
// 若 @ 的是机器人自己则替换为空，避免截断 /help 等命令。

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeAtName(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type RawMention = { id: string | Record<string, unknown>; key: string; name?: string };

function normalizeMentions(
  text: string,
  mentions: RawMention[] | undefined,
  botOpenId: string,
  botUnionId: string,
  getIdParts: (id: unknown) => { openId: string; unionId?: string },
  getDisplayName: (openId: string, fallbackName: string) => string,
): string {
  if (!mentions?.length) return text;
  let result = text;
  for (const m of mentions) {
    const key = (m.key ?? '').trim();
    if (!key) continue;
    const { openId, unionId } = getIdParts(m.id);
    const isBot =
      (botOpenId && openId === botOpenId) || (botUnionId && unionId === botUnionId);
    const replacement = isBot
      ? ''
      : openId
        ? `<at user_id="${openId}">${escapeAtName(getDisplayName(openId, m.name ?? ''))}</at>`
        : `@${escapeAtName(m.name ?? '')}`;
    result = result.replace(new RegExp(escapeRegex(key), 'g'), () => replacement);
  }
  return result.trim();
}

// ── 消息内容解析 ──────────────────────────────────────────────────────────────
/** rawMentions 仅用于 post：按顺序将 at 元素替换为 mention.key，便于后续 normalizeMentions 识别是谁 */
function parseFeishuContent(
  msgType: string,
  contentStr: string,
  rawMentions?: RawMention[],
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
        // 富文本：提取 text；at 按顺序用 rawMentions[i].key 占位，便于 normalizeMentions 替换为 <at>显示名</at>
        const zh = (obj['zh_cn'] ?? obj['en_us'] ?? obj) as {
          title?: string;
          content?: unknown[][];
        };
        let atIndex = 0;
        const lines: string[] = [];
        if (zh.title) lines.push(zh.title);
        for (const row of zh.content ?? []) {
          const rowText = (row as unknown[])
            .filter((el): el is Record<string, unknown> => typeof el === 'object' && el !== null)
            .map((el) => {
              if (el['tag'] === 'text') return String(el['text'] ?? '');
              if (el['tag'] === 'at') {
                if (rawMentions && atIndex < rawMentions.length) {
                  return rawMentions[atIndex++]!.key;
                }
                atIndex++;
                return '@';
              }
              return '';
            })
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
