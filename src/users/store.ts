/**
 * User Store — 用户身份注册与频道优先级动态学习
 *
 * 职责：
 * 1. 注册用户，绑定跨频道账号（一个 user_id ↔ 多个 channel binding）
 * 2. resolveUser(rawId, channelId) → user_id
 * 3. 动态接入新渠道用户（autoRegister）
 * 4. 记录 BLOCK 通知响应时间，动态调整 channel priority
 * 5. 持久化到 <obDir>/users.json
 *
 * 身份映射设计：
 *   - 内部 user_id 是抽象身份（如 "bob"），跨渠道稳定
 *   - 每个用户可绑定多个 channel（feishu / dingtalk / webchat / cli）
 *   - 未知用户首次接入时自动注册为 "<channelId>_<rawId>"，管理员可事后 link
 *
 * 声明式预配置（ob-agent/identity-config.json）：
 *   {
 *     "users": [
 *       { "userId": "bob", "displayName": "Bob", "role": "member",
 *         "channels": [
 *           { "channelId": "feishu",   "rawId": "ou_xxxxxxxxxxxx" },
 *           { "channelId": "dingtalk", "rawId": "user_yyy" },
 *           { "channelId": "webchat",  "rawId": "bob" }
 *         ]
 *       }
 *     ]
 *   }
 *
 * priority 越小 = 越优先通知。初始值由注册顺序决定。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { User, UserChannelBinding, UserRole } from '../channels/types.js';

/** identity-config.json 的结构 */
interface IdentityConfig {
  users: Array<{
    userId: string;
    displayName?: string;
    role?: UserRole;
    channels: Array<{ channelId: string; rawId: string; priority?: number }>;
  }>;
}

export class UserStore {
  private readonly filePath: string;
  private readonly users = new Map<string, User>();
  /** raw → userId 的快速查找：key = "<channelId>:<rawId>" */
  private readonly rawIndex = new Map<string, string>();

  constructor(obDir: string) {
    this.filePath = path.join(obDir, 'users.json');
    this.load();
    // 自动加载声明式身份配置（如果存在）
    const identityConfigPath = path.join(obDir, 'identity-config.json');
    if (fs.existsSync(identityConfigPath)) {
      this.loadIdentityConfig(identityConfigPath);
    }
  }

  // ── 查找 ─────────────────────────────────────────────────────────────────

  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  allUsers(): User[] {
    return [...this.users.values()];
  }

  /**
   * 根据平台原始 ID 解析统一 user_id。
   * 未找到返回 null（可用 autoRegister 选项自动注册）。
   */
  resolveUser(rawId: string, channelId: string, autoRegister = false): string | null {
    const key = `${channelId}:${rawId}`;
    const found = this.rawIndex.get(key);
    if (found) return found;

    if (autoRegister) {
      const userId = this.register({
        userId: `${channelId}_${rawId}`,
        displayName: rawId,
        role: 'member',
        channels: [{ channelId, rawId, priority: 1 }],
      });
      return userId;
    }

    return null;
  }

  // ── 注册 / 更新 ───────────────────────────────────────────────────────────

  register(opts: {
    userId: string;
    displayName: string;
    role?: UserRole;
    channels: Array<{ channelId: string; rawId: string; priority?: number }>;
  }): string {
    const now = Date.now();
    const bindings: UserChannelBinding[] = opts.channels.map((c, i) => ({
      channel_id: c.channelId,
      raw_id: c.rawId,
      priority: c.priority ?? i + 1,
    }));

    const existing = this.users.get(opts.userId);
    if (existing) {
      // 合并新频道绑定
      for (const b of bindings) {
        const dup = existing.channels.find(
          (c) => c.channel_id === b.channel_id && c.raw_id === b.raw_id,
        );
        if (!dup) existing.channels.push(b);
      }
      existing.last_seen_at = now;
      this.rebuildIndex();
      this.save();
      return opts.userId;
    }

    const user: User = {
      user_id: opts.userId,
      display_name: opts.displayName,
      role: opts.role ?? 'member',
      channels: bindings,
      created_at: now,
      last_seen_at: now,
    };
    this.users.set(opts.userId, user);
    this.rebuildIndex();
    this.save();
    return opts.userId;
  }

  updateLastSeen(userId: string): void {
    const user = this.users.get(userId);
    if (user) {
      user.last_seen_at = Date.now();
      this.save();
    }
  }

  /**
   * 将一个 channel 的原始 ID 绑定到已存在的内部用户。
   * 用于管理员将动态注册的匿名用户（如 feishu_ou_xxx）关联到真实身份（如 bob）。
   *
   * 场景：
   *   1. Feishu 用户首次消息 → 自动注册为 "feishu_ou_abc"
   *   2. 管理员调用 linkChannel("bob", "feishu", "ou_abc")
   *   3. 后续 feishu:ou_abc 的消息都解析为 user_id="bob"
   *   4. 旧的 "feishu_ou_abc" 临时账号可选择性清理
   */
  linkChannel(userId: string, channelId: string, rawId: string): void {
    if (!this.users.has(userId)) {
      throw new Error(`UserStore: user "${userId}" not found, register first`);
    }
    this.register({ userId, displayName: userId, channels: [{ channelId, rawId }] });
  }

  /**
   * 从声明式配置文件加载身份映射。
   * 会覆盖同 userId 的现有 channel 配置（幂等）。
   * 文件格式见模块头部注释（identity-config.json）。
   */
  loadIdentityConfig(configPath: string): void {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as IdentityConfig;
      for (const u of config.users ?? []) {
        this.register({
          userId:      u.userId,
          displayName: u.displayName ?? u.userId,
          ...(u.role !== undefined ? { role: u.role } : {}),
          channels:    u.channels,
        });
      }
    } catch { /* 配置格式错误时跳过，不影响启动 */ }
  }

  // ── BLOCK 响应学习 ────────────────────────────────────────────────────────

  /**
   * 记录某个 channel 对 BLOCK 通知的响应时间，动态调整 priority。
   * 响应越快的 channel priority 越高（数字越小）。
   */
  recordBlockResponse(userId: string, channelId: string, responseMs: number): void {
    const user = this.users.get(userId);
    if (!user) return;

    const binding = user.channels.find((c) => c.channel_id === channelId);
    if (!binding) return;

    // 指数移动平均
    const prev = binding.avg_response_ms ?? responseMs;
    binding.avg_response_ms = prev * 0.7 + responseMs * 0.3;

    // 按响应时间重新排序 priority
    const sorted = [...user.channels].sort((a, b) => {
      const ra = a.avg_response_ms ?? Infinity;
      const rb = b.avg_response_ms ?? Infinity;
      return ra - rb;
    });
    sorted.forEach((ch, i) => {
      ch.priority = i + 1;
    });

    this.save();
  }

  /**
   * 返回用户的 channel 列表，按 priority 升序排列（最优先的在前）。
   */
  getChannelsByPriority(userId: string): UserChannelBinding[] {
    const user = this.users.get(userId);
    if (!user) return [];
    return [...user.channels].sort((a, b) => a.priority - b.priority);
  }

  // ── 持久化 ────────────────────────────────────────────────────────────────

  private save(): void {
    const data = [...this.users.values()];
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as User[];
      for (const user of data) {
        this.users.set(user.user_id, user);
      }
      this.rebuildIndex();
    } catch { /* start fresh */ }
  }

  private rebuildIndex(): void {
    this.rawIndex.clear();
    for (const user of this.users.values()) {
      for (const ch of user.channels) {
        this.rawIndex.set(`${ch.channel_id}:${ch.raw_id}`, user.user_id);
      }
    }
  }
}
