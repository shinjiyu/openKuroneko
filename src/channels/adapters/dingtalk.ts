/**
 * 钉钉 Bot 频道适配器（Stream 模式）
 *
 * ── 接入方式 ──────────────────────────────────────────────────────────────────
 *
 * 使用 Stream 长连接（官方推荐，无需公网 URL / ngrok）：
 *   1. 钉钉开发者后台 → 创建企业内部应用 → 获取 ClientID / ClientSecret
 *   2. 应用能力 → 添加「机器人」→ 勾选「Stream 模式」→ 发布
 *   3. 配置本适配器：clientId = AppKey，clientSecret = AppSecret
 *
 * ── 消息类型支持 ──────────────────────────────────────────────────────────────
 *
 * 接收：
 *   text      纯文本（含 @mention 解析）
 *   picture   图片（记录 downloadCode，暂不自动下载）
 *   file      文件（记录 fileName，暂不自动下载）
 *   richText  富文本（提取纯文本段落）
 *   audio     语音（记录 downloadCode）
 *
 * 发送：
 *   文本：send({ thread_id, content })
 *   Markdown：send({ thread_id, content })  —— content 含 ## 标题等自动识别
 *   图片/文件：send({ thread_id, content, attachments: [{ type:'image'|'file', url }] })
 *     • url 为 file:// 本地路径 → 先上传到钉钉媒体，再发送
 *     • url 为 https:// 公开地址 → 直接通过 photoURL 发图（仅图片）
 *
 * ── thread_id 格式 ────────────────────────────────────────────────────────────
 *
 *   私信：dingtalk:dm:<openConversationId>
 *   群聊：dingtalk:group:<openConversationId>
 *
 * ── 配置参数 ──────────────────────────────────────────────────────────────────
 *
 *   clientId       AppKey（同时用作 robotCode）
 *   clientSecret   AppSecret
 *   resolveUserFn  staffId → 内部 user_id 的映射函数
 */

import fs   from 'node:fs';
import path from 'node:path';

import type { ChannelAdapter, InboundMessage, OutboundMessage, MessageAttachment } from '../types.js';
import type { DWClient, DWClientDownStream } from 'dingtalk-stream';

interface DingTalkMessage {
  msgtype:            string;            // "text" | "picture" | "file" | "richText" | "audio"
  text?:              { content: string };
  content?:           { rich?: Array<{ type: string; downloadCode?: string; text?: { content: string } }> };
  picture?:           { downloadCode: string };
  file?:              { downloadCode: string; fileName: string };
  audio?:             { downloadCode: string };
  senderStaffId?:     string;            // 发送者 staffId（组织内用户 ID，系统消息可能缺失）
  senderNick?:        string;
  conversationId:     string;            // openConversationId（同时用于 DM 和群）
  conversationType:   string;            // "1"=私信 "2"=群聊
  chatbotUserId:      string;            // bot 自身 ID（用于过滤自发消息）
  robotCode:          string;
  atUsers?:           Array<{ staffId: string; dingtalkId?: string }>;
  sessionWebhook?:    string;
}

// ── 适配器配置 ────────────────────────────────────────────────────────────────

export interface DingTalkAdapterOptions {
  /** AppKey，也是 robotCode */
  clientId:     string;
  /** AppSecret */
  clientSecret: string;
  resolveUserFn: (rawUserId: string, channelId: string) => string | null;
}

// ── 钉钉 Open API base URL ────────────────────────────────────────────────────

const DINGTALK_API = 'https://api.dingtalk.com';

// ── 适配器实现 ────────────────────────────────────────────────────────────────

export class DingTalkChannelAdapter implements ChannelAdapter {
  readonly channel_id = 'dingtalk';
  readonly name       = '钉钉 Bot';

  private readonly opts: DingTalkAdapterOptions;

  /** access_token 缓存 */
  private accessToken:   string | null = null;
  private tokenExpireAt: number        = 0;

  /** 动态加载的 SDK 客户端 */
  private client: DWClient | null = null;

  constructor(opts: DingTalkAdapterOptions) {
    this.opts = opts;
  }

  // ── start ─────────────────────────────────────────────────────────────────

  async start(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    const { DWClient, TOPIC_ROBOT } = await import('dingtalk-stream');

    this.client = new DWClient({
      clientId:     this.opts.clientId,
      clientSecret: this.opts.clientSecret,
    });

    this.client.registerCallbackListener(TOPIC_ROBOT, (res: DWClientDownStream) => {
      void (async () => {
        try {
          const raw = JSON.parse(res.data) as DingTalkMessage;
          const msg = this.parseMessage(raw);
          if (msg) await onMessage(msg);
          // 及时 ack 避免 60s 内重推
          this.client?.socketCallBackResponse(res.headers.messageId, { result: 'SUCCESS' });
        } catch (e) {
          console.error('[dingtalk] message parse error:', e);
        }
      })();
    });

    await this.client.connect();
    console.info('[dingtalk] Stream long-connection started (no public URL needed)');
  }

  // ── send ──────────────────────────────────────────────────────────────────

  async send(msg: OutboundMessage): Promise<void> {
    const token = await this.getToken();
    const parts = msg.thread_id.split(':');   // ["dingtalk", "dm"|"group", "<openConversationId>"]
    const type  = parts[1];
    const openConversationId = parts.slice(2).join(':');

    if (!openConversationId) throw new Error(`[dingtalk] invalid thread_id: ${msg.thread_id}`);

    // 附件优先（图片）
    const attachment = msg.attachments?.[0];
    if (attachment?.type === 'image' && attachment.url) {
      await this.sendImage(openConversationId, type ?? 'dm', attachment, token);
      // 图片后追加文字说明（如果有）
      if (msg.content?.trim()) {
        await this.sendText(openConversationId, type ?? 'dm', msg.content, token);
      }
      return;
    }

    // 文件附件：上传后发送
    if (attachment?.type === 'file' && attachment.url) {
      await this.sendFile(openConversationId, type ?? 'dm', attachment, token);
      if (msg.content?.trim()) {
        await this.sendText(openConversationId, type ?? 'dm', msg.content, token);
      }
      return;
    }

    // 纯文本（或 Markdown）
    await this.sendText(openConversationId, type ?? 'dm', msg.content, token);
  }

  resolveUser(rawUserId: string, channelId: string): string | null {
    return this.opts.resolveUserFn(rawUserId, channelId);
  }

  async stop(): Promise<void> {
    // Stream SDK 无显式 disconnect API，依赖进程退出
  }

  // ── 消息解析 ─────────────────────────────────────────────────────────────

  private parseMessage(raw: DingTalkMessage): InboundMessage | null {
    // senderStaffId 缺失（系统消息/回调消息）→ 忽略
    if (!raw.senderStaffId) return null;

    const rawUserId = raw.senderStaffId;
    const userId    = this.opts.resolveUserFn(rawUserId, 'dingtalk') ?? rawUserId;

    const isGroup  = raw.conversationType === '2';
    const threadId = isGroup
      ? `dingtalk:group:${raw.conversationId}`
      : `dingtalk:dm:${raw.conversationId}`;

    const { content, attachments } = parseDingTalkContent(raw);

    // @mention：群聊消息只要 bot 收到就是被 @（钉钉机器人仅在 @ 时才收消息）
    const isMention = isGroup;
    const mentions  = isGroup
      ? (raw.atUsers ?? []).map(
          (u) => this.opts.resolveUserFn(u.staffId, 'dingtalk') ?? u.staffId,
        )
      : [];

    // 去掉 @bot 前缀（钉钉群消息 content 以 "@机器人名 " 开头）
    const cleanContent = content.replace(/^@\S+\s*/u, '').trim();

    return {
      id:           `dt-${raw.conversationId}-${Date.now()}`,
      thread_id:    threadId,
      channel_id:   'dingtalk',
      user_id:      userId,
      raw_user_id:  rawUserId,
      content:      cleanContent,
      is_mention:   isMention,
      mentions,
      ts:           Date.now(),
      attachments:  attachments.length > 0 ? attachments : undefined,
      group_info:   isGroup ? { group_id: raw.conversationId, group_name: raw.conversationId } : undefined,
    };
  }

  // ── 发送辅助 ─────────────────────────────────────────────────────────────

  private async sendText(
    openConversationId: string,
    type:               string,
    content:            string,
    token:              string,
  ): Promise<void> {
    // 自动检测 Markdown（含 # 标题、** 加粗、- 列表等）
    const isMarkdown = /^#{1,3} |^\*\*|\n[-*] /m.test(content);
    const msgKey   = isMarkdown ? 'sampleMarkdown' : 'sampleText';
    const msgParam = isMarkdown
      ? JSON.stringify({ title: (content.split('\n')[0] ?? '').replace(/^#+\s*/, '').slice(0, 50), text: content })
      : JSON.stringify({ content });

    await this.callSendApi(openConversationId, type, msgKey, msgParam, token);
  }

  private async sendImage(
    openConversationId: string,
    type:               string,
    attachment:         MessageAttachment,
    token:              string,
  ): Promise<void> {
    const url = attachment.url ?? '';

    if (url.startsWith('https://') || url.startsWith('http://')) {
      // 公开 URL：直接用 photoURL 发送
      const msgParam = JSON.stringify({ photoURL: url });
      await this.callSendApi(openConversationId, type, 'sampleImageMsg', msgParam, token);
    } else {
      // 本地文件（file://）：先上传到钉钉，再发送
      const mediaId = await this.uploadMedia(url, 'image', attachment.name ?? 'image.png', token);
      if (mediaId) {
        const msgParam = JSON.stringify({ photoURL: `dingtalk://media?mediaId=${mediaId}` });
        await this.callSendApi(openConversationId, type, 'sampleImageMsg', msgParam, token);
      }
    }
  }

  private async sendFile(
    openConversationId: string,
    type:               string,
    attachment:         MessageAttachment,
    token:              string,
  ): Promise<void> {
    const url = attachment.url ?? '';
    // 文件发送：先上传获取 mediaId，再用 sampleFile 消息类型
    const mediaId = await this.uploadMedia(url, 'file', attachment.name ?? 'file', token);
    if (mediaId) {
      const msgParam = JSON.stringify({
        mediaId,
        fileName: attachment.name ?? 'file',
        fileType: path.extname(attachment.name ?? '').slice(1).toLowerCase() || 'bin',
      });
      await this.callSendApi(openConversationId, type, 'sampleFile', msgParam, token);
    }
  }

  /**
   * 统一调用发送 API：
   *   DM    → /v1.0/robot/oToMessages/send
   *   Group → /v1.0/robot/groupMessages/send
   */
  private async callSendApi(
    openConversationId: string,
    type:               string,
    msgKey:             string,
    msgParam:           string,
    token:              string,
  ): Promise<void> {
    const endpoint = type === 'group'
      ? `${DINGTALK_API}/v1.0/robot/groupMessages/send`
      : `${DINGTALK_API}/v1.0/robot/oToMessages/send`;

    const body = {
      robotCode:          this.opts.clientId,
      openConversationId,
      msgKey,
      msgParam,
    };

    const res = await fetch(endpoint, {
      method:  'POST',
      headers: {
        'Content-Type':               'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      body:   JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`[dingtalk] send failed ${res.status}: ${txt}`);
    }
  }

  // ── 媒体上传 ─────────────────────────────────────────────────────────────

  /** 读取文件内容：支持 file:// 和 HTTP(S) URL */
  private async fetchBytes(url: string): Promise<{ data: ArrayBuffer; name: string }> {
    if (url.startsWith('file://')) {
      const localPath = url.slice('file://'.length);
      const buf = fs.readFileSync(localPath);
      return {
        data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
        name: path.basename(localPath),
      };
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const name = url.split('/').pop() ?? 'file';
    return { data: await res.arrayBuffer(), name };
  }

  private async uploadMedia(
    url:      string,
    type:     'image' | 'file',
    fileName: string,
    token:    string,
  ): Promise<string | null> {
    try {
      const { data, name } = await this.fetchBytes(url);
      const form = new FormData();
      form.append('media', new Blob([data]), name || fileName);
      form.append('type', type === 'image' ? 'image' : 'file');

      const res = await fetch(`${DINGTALK_API}/media/upload`, {
        method:  'POST',
        headers: { 'x-acs-dingtalk-access-token': token },
        body:    form,
        signal:  AbortSignal.timeout(30_000),
      });
      const json = (await res.json()) as { mediaId?: string };
      return json.mediaId ?? null;
    } catch (e) {
      console.error('[dingtalk] uploadMedia failed:', e);
      return null;
    }
  }

  // ── Access Token ─────────────────────────────────────────────────────────

  private async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpireAt) {
      return this.accessToken;
    }
    const res = await fetch(`${DINGTALK_API}/v1.0/oauth2/accessToken`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ appKey: this.opts.clientId, appSecret: this.opts.clientSecret }),
      signal:  AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as { accessToken: string; expireIn: number };
    this.accessToken   = data.accessToken;
    this.tokenExpireAt = Date.now() + (data.expireIn - 60) * 1000; // 提前 60s 刷新
    return this.accessToken;
  }
}

// ── 消息内容解析 ──────────────────────────────────────────────────────────────

function parseDingTalkContent(
  raw: DingTalkMessage,
): { content: string; attachments: MessageAttachment[] } {
  switch (raw.msgtype) {
    case 'text':
      return { content: raw.text?.content ?? '', attachments: [] };

    case 'picture': {
      const code = raw.picture?.downloadCode;
      return {
        content:     '[图片]',
        attachments: code ? [{ type: 'image', url: `dingtalk-media://${code}`, name: code }] : [],
      };
    }

    case 'audio': {
      const code = raw.audio?.downloadCode;
      return {
        content:     '[语音]',
        attachments: code ? [{ type: 'audio', url: `dingtalk-media://${code}`, name: code }] : [],
      };
    }

    case 'file': {
      const code     = raw.file?.downloadCode;
      const fileName = raw.file?.fileName;
      return {
        content:     `[文件${fileName ? ': ' + fileName : ''}]`,
        attachments: code
          ? [{ type: 'file', url: `dingtalk-media://${code}`, name: fileName ?? code }]
          : [],
      };
    }

    case 'richText': {
      // 富文本：提取所有 text 段落合并
      const segments = raw.content?.rich ?? [];
      const texts    = segments
        .filter((s) => s.type === 'text' && s.text?.content)
        .map((s) => s.text!.content)
        .join('');
      const picCodes = segments
        .filter((s): s is typeof s & { downloadCode: string } => s.type === 'picture' && !!s.downloadCode)
        .map((s): MessageAttachment => ({ type: 'image', url: `dingtalk-media://${s.downloadCode}`, name: s.downloadCode }));
      return { content: texts, attachments: picCodes };
    }

    default:
      return { content: `[${raw.msgtype ?? '未知'}消息]`, attachments: [] };
  }
}
