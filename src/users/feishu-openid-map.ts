/**
 * 飞书 open_id → name / union_id 映射（持久化到 obDir）
 *
 * 用途：
 * 1. 从 sdk.raw_receive 的 sender / mentions 中抽取 (open_id, name, union_id)，建立 open_id → 展示名
 * 2. 多 agent 场景：同一人在不同机器人下 open_id 不同，union_id 跨应用一致，用 union_id 表示「同一人」
 * 3. lastSeenAt：该 open_id 最近一次出现在事件中的时间戳，用于 getOpenIdForUnionId 时优先返回「当前应用」的 open_id，避免 open_id cross app
 *
 * 文件格式：<obDir>/feishu-openid-map.json
 *   { "ou_xxx": { "name": "张三", "union_id": "on_yyy", "lastSeenAt": 1234567890 }, ... }
 */

import fs from 'node:fs';
import path from 'node:path';

export type FeishuIdEntry = { name?: string; union_id?: string; lastSeenAt?: number };

export class FeishuOpenIdMap {
  private readonly filePath: string;
  private map = new Map<string, FeishuIdEntry>();

  constructor(obDir: string) {
    this.filePath = path.join(obDir, 'feishu-openid-map.json');
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const obj = JSON.parse(raw) as Record<string, FeishuIdEntry>;
      this.map = new Map(Object.entries(obj));
    } catch {
      this.map = new Map();
    }
  }

  private save(): void {
    const obj = Object.fromEntries(this.map);
    fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf8');
  }

  /**
   * 合并一批从飞书事件中解析出的 (open_id, name?, union_id?)。
   * 已有条目只做补充（不覆盖已有 name/union_id 为空的新值）。
   * 每次合并都会更新该 open_id 的 lastSeenAt，便于 getOpenIdForUnionId 优先返回当前应用下的 open_id。
   */
  merge(entries: Array<{ openId: string; unionId?: string; name?: string }>): void {
    const now = Date.now();
    let changed = false;
    for (const e of entries) {
      const key = e.openId?.trim();
      if (!key) continue;
      const cur = this.map.get(key) ?? {};
      const next: FeishuIdEntry = { ...cur, lastSeenAt: now };
      if (e.name?.trim()) next.name = next.name || e.name.trim();
      if (e.unionId?.trim()) next.union_id = next.union_id || e.unionId.trim();
      const prev = this.map.get(key);
      if (!prev || prev.name !== next.name || prev.union_id !== next.union_id || (prev.lastSeenAt ?? 0) < now) {
        this.map.set(key, next);
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /**
   * 仅按 union_id 更新展示名（用于中转广播：只有 union_id + name，无 open_id，且不能把发言者应用的 open_id 写入本应用）。
   * 只更新本 map 中已存在且 union_id 匹配的条目的 name；不新增条目。
   */
  mergeByUnionId(unionId: string, name: string): void {
    const u = unionId.trim();
    const n = name?.trim();
    if (!u || !n) return;
    let changed = false;
    for (const [openId, entry] of this.map) {
      if (entry.union_id !== u) continue;
      const next = { ...entry, name: n };
      if (entry.name !== n) {
        this.map.set(openId, next);
        changed = true;
      }
    }
    if (changed) this.save();
  }

  get(openId: string): FeishuIdEntry | undefined {
    return this.map.get(openId.trim());
  }

  getName(openId: string): string | undefined {
    return this.map.get(openId.trim())?.name;
  }

  getUnionId(openId: string): string | undefined {
    return this.map.get(openId.trim())?.union_id;
  }

  /** 按 union_id 查找本应用下对应的 open_id（多 agent 时可用于「同一人」解析） */
  getOpenIdsByUnionId(unionId: string): string[] {
    const u = unionId.trim();
    const list: string[] = [];
    for (const [openId, entry] of this.map) {
      if (entry.union_id === u) list.push(openId);
    }
    return list;
  }

  /**
   * 本应用下该 union_id 对应的一个 open_id（发 DM 时用），无则返回 null。
   * 同一用户在不同应用下会有多个 open_id，优先返回 lastSeenAt 最大的（最近一次在本实例事件中出现的），避免 open_id cross app。
   */
  getOpenIdForUnionId(unionId: string): string | null {
    const ids = this.getOpenIdsByUnionId(unionId);
    if (ids.length === 0) return null;
    if (ids.length === 1) return ids[0]!;
    let best = ids[0]!;
    let bestAt = this.map.get(best)?.lastSeenAt ?? 0;
    for (let i = 1; i < ids.length; i++) {
      const oid = ids[i]!;
      const at = this.map.get(oid)?.lastSeenAt ?? 0;
      if (at > bestAt) {
        best = oid;
        bestAt = at;
      }
    }
    return best;
  }

  /**
   * 按 union_id 查一条映射（任一本应用 open_id + 展示名）。
   * 用于以 union_id 为主键时由 union_id 反查 open_id 与 name。
   */
  getEntryByUnionId(unionId: string): { openId: string; name?: string } | undefined {
    const openId = this.getOpenIdForUnionId(unionId);
    if (!openId) return undefined;
    const entry = this.map.get(openId);
    if (!entry) return { openId };
    return entry.name !== undefined && entry.name !== '' ? { openId, name: entry.name } : { openId };
  }

  /**
   * 用 open_id 或 union_id 查展示名。
   * id 为 ou_ 前缀走 open_id，on_ 前缀走 union_id（查本应用下任一 open_id 的 name）。
   */
  getDisplayName(id: string): string | undefined {
    const t = id.trim();
    if (t.startsWith('ou_')) return this.getName(t);
    if (t.startsWith('on_')) return this.getEntryByUnionId(t)?.name;
    return this.getName(t) ?? this.getEntryByUnionId(t)?.name;
  }

  /**
   * 按展示名反查一个 open_id（用于出站 @：把 @名字 转成 at 标签）。
   * 多个条目同名时返回第一个；无匹配返回 undefined。
   * 匹配不区分大小写（LLM 可能输出 Kuroneko，map 存 kuroneko）。
   */
  getOpenIdByDisplayName(displayName: string): string | undefined {
    const want = displayName.trim();
    if (!want) return undefined;
    const wantLower = want.toLowerCase();
    for (const [openId, entry] of this.map) {
      const entryName = entry.name?.trim();
      if (entryName !== undefined && entryName !== '' && entryName.toLowerCase() === wantLower) return openId;
    }
    return undefined;
  }

  all(): Map<string, FeishuIdEntry> {
    return new Map(this.map);
  }
}
