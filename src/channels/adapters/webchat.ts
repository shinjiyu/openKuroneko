/**
 * WebChat 频道适配器（HTTP + SSE）
 *
 * ── API ──────────────────────────────────────────────────────────────────────
 *
 * 认证：
 *   所有请求需携带 Authorization: Bearer <token>
 *   token → user_id 映射来自 <obDir>/webchat-users.json（见下方格式）
 *
 * 私信（DM）：
 *   POST /webchat/message          body: { content }
 *   GET  /webchat/events           SSE，外脑回复推流
 *   → thread_id: "webchat:dm:<user_id>"
 *
 * 群聊（Group）：
 *   POST /webchat/message          body: { content, room_id }
 *   GET  /webchat/events?room=<id> SSE，订阅指定群组
 *   → thread_id: "webchat:group:<room_id>"
 *   → 内容含 @<agentName> 时自动置 is_mention=true
 *
 * ── webchat-users.json 格式 ───────────────────────────────────────────────────
 *   {
 *     "users": [
 *       { "user_id": "alice", "token": "tok_abc123", "display_name": "Alice" },
 *       { "user_id": "bob",   "token": "tok_def456", "display_name": "Bob"   }
 *     ],
 *     "rooms": [
 *       { "room_id": "project", "name": "项目组" }
 *     ]
 *   }
 *
 * ── 管理接口 ──────────────────────────────────────────────────────────────────
 *   GET  /webchat/me       → 返回当前 token 对应的用户信息
 *   GET  /webchat/rooms    → 列出所有 room（认证后可见）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ChannelAdapter, InboundMessage, OutboundMessage } from '../types.js';
import type { InnerBrainPool } from '../../outer-brain/inner-brain-pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** dist 构建不复制 .html，运行 node dist/... 时需回退到源码目录 */
function resolveWebchatUiPath(): string {
  const besideModule = path.join(__dirname, 'webchat-ui.html');
  if (fs.existsSync(besideModule)) return besideModule;
  const fromSrc = path.join(process.cwd(), 'src/channels/adapters/webchat-ui.html');
  if (fs.existsSync(fromSrc)) return fromSrc;
  const fromDist = path.join(process.cwd(), 'dist/channels/adapters/webchat-ui.html');
  if (fs.existsSync(fromDist)) return fromDist;
  return besideModule;
}

// ── 配置类型 ─────────────────────────────────────────────────────────────────

export interface WebchatUserEntry {
  user_id:      string;
  token:        string;
  display_name?: string | undefined;
}

export interface WebchatRoomEntry {
  room_id: string;
  name:    string;
}

export interface WebchatUsersConfig {
  users: WebchatUserEntry[];
  rooms: WebchatRoomEntry[];
}

export interface WebchatAdapterOptions {
  /** 监听端口，默认 8091 */
  port?: number;
  /**
   * webchat-users.json 路径。
   * 不存在时允许匿名（anonymous），生产环境建议必须配置。
   */
  usersConfigPath?: string | undefined;
  /** agent 在群聊中被 @提及时使用的名字（由渠道或配置提供；不设则无法通过 @ 触发回复） */
  agentName?: string | undefined;
  /** CORS 允许来源，默认 "*" */
  corsOrigin?: string | undefined;
  /**
   * 内脑进程池（多实例支持）。
   * 提供后 /webchat/inner-brain/list 和 /webchat/inner-brain/logs 接口会列出所有实例。
   */
  pool?: InnerBrainPool | undefined;
  /**
   * 内脑状态文件路径（兼容旧单实例，不推荐）。
   * @deprecated 请改用 pool
   */
  innerStatusFile?: string | undefined;
}

// ── SSE 客户端 ───────────────────────────────────────────────────────────────

interface SseClient {
  /** 订阅的 key：DM 时为 user_id，群组时为 "room:<room_id>" */
  key: string;
  /** 订阅者的 user_id，用于排除自己的广播 */
  userId: string;
  res: ServerResponse;
}

// ── 适配器实现 ────────────────────────────────────────────────────────────────

export class WebchatChannelAdapter implements ChannelAdapter {
  readonly channel_id = 'webchat';
  readonly name       = 'Web Chat';

  private readonly opts:       WebchatAdapterOptions;
  private server:              import('node:http').Server | null = null;
  private sseClients:          SseClient[] = [];
  private readonly bootTs:     number = Date.now();
  private usersConfig:         WebchatUsersConfig = { users: [], rooms: [] };
  /** token → user entry 快速查找 */
  private tokenIndex:          Map<string, WebchatUserEntry> = new Map();
  private configWatcher:       fs.FSWatcher | null = null;

  constructor(opts: WebchatAdapterOptions) {
    this.opts = opts;
    this.loadConfig();
  }

  // ── ChannelAdapter 接口 ────────────────────────────────────────────────────

  async start(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    const http   = await import('node:http');
    const port   = this.opts.port ?? 8091;
    const cors   = this.opts.corsOrigin ?? '*';

    this.server = http.createServer(async (req, res) => {
      // CORS 预检
      res.setHeader('Access-Control-Allow-Origin', cors);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      await this.route(req, res, onMessage, port);
    });

    this.server.listen(port, () => {
      console.info(`[webchat] listening on :${port}`);
    });

    // 监听 config 变更，热载
    if (this.opts.usersConfigPath) {
      try {
        this.configWatcher = fs.watch(this.opts.usersConfigPath, () => this.loadConfig());
      } catch { /* 文件不存在时忽略 */ }
    }
  }

  async send(msg: OutboundMessage): Promise<void> {
    // thread_id: webchat:dm:<userId> | webchat:group:<roomId>
    const parts  = msg.thread_id.split(':');
    const type   = parts[1];
    const peerId = parts.slice(2).join(':');

    const key   = type === 'group' ? `room:${peerId}` : peerId;
    const event = sseEvent({
      thread_id: msg.thread_id,
      content:   msg.content,
      ts:        Date.now(),
    });

    for (const client of this.sseClients) {
      if (client.key === key) {
        client.res.write(event);
      }
    }
  }

  resolveUser(rawUserId: string, _channelId: string): string | null {
    // webchat 的 rawUserId 已经是 user_id（token 校验后得到）
    return rawUserId;
  }

  async stop(): Promise<void> {
    this.configWatcher?.close();
    for (const c of this.sseClients) c.res.end();
    this.sseClients = [];

    await new Promise<void>((resolve) => {
      if (this.server) this.server.close(() => resolve());
      else resolve();
    });
  }

  // ── 公共：列出用户和房间（供管理工具调用） ──────────────────────────────────

  getUsers(): WebchatUserEntry[] {
    return this.usersConfig.users;
  }

  getRooms(): WebchatRoomEntry[] {
    return this.usersConfig.rooms;
  }

  // ── 路由 ──────────────────────────────────────────────────────────────────

  private async route(
    req:       IncomingMessage,
    res:       ServerResponse,
    onMessage: (msg: InboundMessage) => Promise<void>,
    port:      number,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    // GET / → 内嵌 Web UI
    if ((url.pathname === '/' || url.pathname === '/index.html') && req.method === 'GET') {
      this.serveUi(res);
      return;
    }

    // POST /webchat/message
    if (url.pathname === '/webchat/message' && req.method === 'POST') {
      const user = this.authenticate(req, res, url);
      if (!user) return;
      await this.handleMessage(req, res, onMessage, user);
      return;
    }

    // GET /webchat/events  (SSE — token 可通过 ?token= 传入)
    if (url.pathname === '/webchat/events' && req.method === 'GET') {
      const user = this.authenticate(req, res, url);
      if (!user) return;
      this.handleSse(req, res, url, user);
      return;
    }

    // GET /webchat/me
    if (url.pathname === '/webchat/me' && req.method === 'GET') {
      const user = this.authenticate(req, res, url);
      if (!user) return;
      json(res, 200, { user_id: user.user_id, display_name: user.display_name });
      return;
    }

    // GET /webchat/rooms
    if (url.pathname === '/webchat/rooms' && req.method === 'GET') {
      const user = this.authenticate(req, res, url);
      if (!user) return;
      json(res, 200, { rooms: this.usersConfig.rooms });
      return;
    }

    // GET /webchat/inner-status → 内脑状态快照（兼容旧接口）
    if (url.pathname === '/webchat/inner-status' && req.method === 'GET') {
      const user = this.authenticate(req, res, url);
      if (!user) return;
      this.serveInnerStatus(res);
      return;
    }

    // GET /webchat/inner-brain/list → 内脑实例列表（含状态）
    if (url.pathname === '/webchat/inner-brain/list' && req.method === 'GET') {
      const user = this.authenticate(req, res, url);
      if (!user) return;
      this.serveInnerBrainList(res);
      return;
    }

    // GET /webchat/inner-brain/logs?lines=N&instanceId=xxx → 内脑最近日志行
    if (url.pathname === '/webchat/inner-brain/logs' && req.method === 'GET') {
      const user = this.authenticate(req, res, url);
      if (!user) return;
      const lines      = Math.min(500, Math.max(1, parseInt(url.searchParams.get('lines') ?? '150', 10)));
      const instanceId = url.searchParams.get('instanceId') ?? undefined;
      this.serveInnerBrainLogs(res, lines, instanceId);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
  }

  // ── 认证 ──────────────────────────────────────────────────────────────────

  /**
   * Token 来源（优先级由高到低）：
   *   1. Authorization: Bearer <token>  （API 调用）
   *   2. ?token=<token>                 （SSE / 浏览器直连）
   */
  private authenticate(req: IncomingMessage, res: ServerResponse, url: URL): WebchatUserEntry | null {
    // 无用户配置 → 匿名模式
    if (this.usersConfig.users.length === 0) {
      return { user_id: 'anonymous', token: '', display_name: 'Anonymous' };
    }

    const auth    = req.headers['authorization'] ?? '';
    const fromHdr = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const fromUrl = url.searchParams.get('token') ?? '';
    const token   = fromHdr || fromUrl;

    const user = token ? this.tokenIndex.get(token) : undefined;
    if (!user) {
      json(res, 401, { error: 'Unauthorized: invalid or missing token' });
      return null;
    }
    return user;
  }

  // ── GET / → 内嵌 Web UI ────────────────────────────────────────────────────

  private serveUi(res: ServerResponse): void {
    const uiPath = resolveWebchatUiPath();
    try {
      const html = fs.readFileSync(uiPath, 'utf8');
      res.writeHead(200, {
        'Content-Type':  'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma':        'no-cache',
      });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('UI file not found');
    }
  }

  // ── GET /webchat/inner-status ─────────────────────────────────────────────

  private serveInnerStatus(res: ServerResponse): void {
    const pool = this.opts.pool;
    if (pool) {
      const running = pool.runningInstances();
      if (running.length && running[0]) {
        const sf = path.join(running[0].tempDir, 'status');
        if (fs.existsSync(sf)) {
          try {
            const status = JSON.parse(fs.readFileSync(sf, 'utf8')) as Record<string, unknown>;
            json(res, 200, status);
            return;
          } catch { /* fall through */ }
        }
      }
      json(res, 200, { mode: 'IDLE', blocked: false, block_reason: null });
      return;
    }

    // 兼容旧单实例
    const sf = this.opts.innerStatusFile;
    if (!sf || !fs.existsSync(sf)) {
      json(res, 200, { mode: 'unknown', blocked: false, block_reason: null });
      return;
    }
    try {
      const status = JSON.parse(fs.readFileSync(sf, 'utf8')) as Record<string, unknown>;
      json(res, 200, status);
    } catch {
      json(res, 200, { mode: 'unknown', blocked: false, block_reason: null });
    }
  }

  private serveInnerBrainList(res: ServerResponse): void {
    const pool = this.opts.pool;
    if (!pool) {
      json(res, 200, { instances: [] });
      return;
    }

    const instances = pool.list().map((r) => {
      let status: Record<string, unknown> = { mode: 'unknown', blocked: false };
      const sf = path.join(r.tempDir, 'status');
      if (fs.existsSync(sf)) {
        try { status = JSON.parse(fs.readFileSync(sf, 'utf8')) as Record<string, unknown>; } catch { /* ignore */ }
      }

      const logDir  = path.join(r.tempDir, 'logs');
      const hasLogs = fs.existsSync(logDir) && fs.readdirSync(logDir).some(f => f.endsWith('.jsonl'));
      const milestones = this.parseMilestones(r.workDir);

      return {
        id:         r.id,
        poolStatus: r.status,
        originUser: r.originUser,
        goal:       r.goal.slice(0, 80) + (r.goal.length > 80 ? '…' : ''),
        startedAt:  r.startedAt.toISOString(),
        exitedAt:   r.exitedAt?.toISOString() ?? null,
        status,
        hasLogs,
        milestones,
      };
    });

    json(res, 200, { instances });
  }

  /** 解析 <workDir>/.brain/milestones.md，返回结构化里程碑列表 */
  private parseMilestones(workDir: string): Array<{ id: string; status: string; title: string; desc: string }> {
    const msFile = path.join(workDir, '.brain', 'milestones.md');
    if (!fs.existsSync(msFile)) return [];
    try {
      const content = fs.readFileSync(msFile, 'utf8');
      const lines = content.split('\n').filter(l => l.trim().startsWith('[M'));
      return lines.map(line => {
        // 格式: [M1] [Completed] 标题 — 描述
        const m = line.match(/^\[M(\d+)\]\s+\[(\w+)\]\s+(.+?)(?:\s+—\s+(.+))?$/);
        if (!m) return null;
        return { id: `M${m[1]}`, status: m[2] ?? '', title: m[3]?.trim() ?? '', desc: m[4]?.trim() ?? '' };
      }).filter((x): x is { id: string; status: string; title: string; desc: string } => x !== null);
    } catch {
      return [];
    }
  }

  private serveInnerBrainLogs(res: ServerResponse, lines: number, instanceId?: string): void {
    const pool = this.opts.pool;
    if (!pool) { json(res, 200, { logs: [] }); return; }

    // 确定目标实例的 tempDir
    let tempDir: string | undefined;
    if (instanceId) {
      const record = pool.get(instanceId);
      if (!record) { json(res, 404, { error: `实例 ${instanceId} 不存在` }); return; }
      tempDir = record.tempDir;
    } else {
      // 默认取最新启动的实例
      const all = pool.list();
      tempDir = all.length ? all[0]!.tempDir : undefined;
    }

    if (!tempDir) { json(res, 200, { logs: [] }); return; }

    const logDir = path.join(tempDir, 'logs');
    if (!fs.existsSync(logDir)) { json(res, 200, { logs: [] }); return; }

    const files = fs.readdirSync(logDir).filter(f => f.endsWith('.jsonl')).sort().reverse();
    if (!files.length || !files[0]) { json(res, 200, { logs: [] }); return; }

    const logFile = path.join(logDir, files[0]);
    let content = '';
    try { content = fs.readFileSync(logFile, 'utf8'); } catch { json(res, 200, { logs: [] }); return; }

    const all = content.split('\n').filter(Boolean);
    const last = all.slice(-lines);
    const parsed = last.map(l => {
      try { return JSON.parse(l) as Record<string, unknown>; } catch { return { raw: l } as Record<string, unknown>; }
    });
    json(res, 200, { logs: parsed, instanceId: instanceId ?? pool.list()[0]?.id });
  }

  // ── POST /webchat/message ──────────────────────────────────────────────────

  private async handleMessage(
    req:       IncomingMessage,
    res:       ServerResponse,
    onMessage: (msg: InboundMessage) => Promise<void>,
    user:      WebchatUserEntry,
  ): Promise<void> {
    let body: { content?: string; room_id?: string };
    try {
      body = JSON.parse(await readBody(req)) as { content?: string; room_id?: string };
    } catch {
      json(res, 400, { error: 'invalid json' });
      return;
    }

    const content = (body.content ?? '').trim();
    if (!content) {
      json(res, 400, { error: 'content is required' });
      return;
    }

    const roomId   = body.room_id?.trim();
    const isGroup  = !!roomId;
    const threadId = isGroup
      ? `webchat:group:${roomId}`
      : `webchat:dm:${user.user_id}`;

    // 检测 @mention（群聊中提到 agent 名字）
    const agentName   = this.opts.agentName ?? '';
    const isMention   = isGroup && !!agentName && (
      content.includes(`@${agentName}`) ||
      content.toLowerCase().includes(`@${agentName.toLowerCase()}`)
    );
    const cleanContent = agentName
      ? content.replace(new RegExp(`@${agentName}`, 'gi'), '').trim()
      : content.trim();

    const msg: InboundMessage = {
      id:          `webchat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      thread_id:   threadId,
      channel_id:  'webchat',
      user_id:     user.user_id,
      raw_user_id: user.user_id,
      content:     cleanContent || content,
      is_mention:  isMention,
      mentions:    isMention ? [agentName] : [],
      ts:          Date.now(),
      group_info:  isGroup
        ? {
            group_id:   roomId,
            group_name: this.usersConfig.rooms.find((r) => r.room_id === roomId)?.name ?? roomId,
          }
        : undefined,
    };

    // 群聊消息立即中继给同房间其他 SSE 订阅者（发送者已在本地显示，跳过）
    if (isGroup && roomId) {
      this.broadcastToRoom(roomId, {
        type:        'user_message',
        thread_id:   threadId,
        user_id:     user.user_id,
        display_name: user.display_name ?? user.user_id,
        content:     msg.content,
        ts:          msg.ts,
      }, user.user_id /* 排除发送者 */);
    }

    await onMessage(msg);
    json(res, 200, { ok: true, thread_id: threadId });
  }

  // ── 群消息广播（内部用） ───────────────────────────────────────────────────

  private broadcastToRoom(roomId: string, data: unknown, excludeUserId?: string): void {
    const key   = `room:${roomId}`;
    const event = sseEvent(data);
    for (const client of this.sseClients) {
      if (client.key === key && client.userId !== excludeUserId) {
        client.res.write(event);
      }
    }
  }

  // ── GET /webchat/events (SSE) ─────────────────────────────────────────────

  private handleSse(
    req:  IncomingMessage,
    res:  ServerResponse,
    url:  URL,
    user: WebchatUserEntry,
  ): void {
    // ?room=<room_id> → 订阅群组；无 room → 订阅私信
    const roomId = url.searchParams.get('room')?.trim();
    const key    = roomId ? `room:${roomId}` : user.user_id;

    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });
    // 发送连接成功事件（含用户信息和服务启动时间，用于客户端检测重启）
    res.write(sseEvent({ type: 'connected', user_id: user.user_id, thread_id: roomId ? `webchat:group:${roomId}` : `webchat:dm:${user.user_id}`, server_boot: this.bootTs }));

    const client: SseClient = { key, userId: user.user_id, res };
    this.sseClients.push(client);

    req.on('close', () => {
      this.sseClients = this.sseClients.filter((c) => c !== client);
    });
  }

  // ── 配置加载 ──────────────────────────────────────────────────────────────

  private loadConfig(): void {
    const p = this.opts.usersConfigPath;
    if (!p || !fs.existsSync(p)) {
      this.usersConfig = { users: [], rooms: [] };
      this.tokenIndex  = new Map();
      return;
    }
    try {
      const raw  = fs.readFileSync(p, 'utf8');
      const cfg  = JSON.parse(raw) as Partial<WebchatUsersConfig>;
      this.usersConfig = {
        users: cfg.users ?? [],
        rooms: cfg.rooms ?? [],
      };
      this.tokenIndex = new Map(this.usersConfig.users.map((u) => [u.token, u]));
    } catch (e) {
      console.error('[webchat] failed to load users config:', e);
    }
  }
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
