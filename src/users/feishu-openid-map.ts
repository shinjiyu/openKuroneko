/**
 * 飞书 open_id → name / union_id 映射（持久化到 obDir）
 *
 * 用途：
 * 1. 从 sdk.raw_receive 的 sender / mentions 中抽取 (open_id, name, union_id)，建立 open_id → 展示名
 * 2. 多 agent 场景：同一人在不同机器人下 open_id 不同，union_id 跨应用一致，用 union_id 表示「同一人」
 *
 * 文件格式：<obDir>/feishu-openid-map.json
 *   { "ou_xxx": { "name": "张三", "union_id": "on_yyy" }, ... }
 */

import fs from 'node:fs';
import path from 'node:path';

export type FeishuIdEntry = { name?: string; union_id?: string };

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
   */
  merge(entries: Array<{ openId: string; unionId?: string; name?: string }>): void {
    let changed = false;
    for (const e of entries) {
      const key = e.openId?.trim();
      if (!key) continue;
      const cur = this.map.get(key) ?? {};
      const next: FeishuIdEntry = { ...cur };
      if (e.name?.trim()) next.name = next.name || e.name.trim();
      if (e.unionId?.trim()) next.union_id = next.union_id || e.unionId.trim();
      const prev = this.map.get(key);
      if (!prev || prev.name !== next.name || prev.union_id !== next.union_id) {
        this.map.set(key, next);
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

  /** 本应用下该 union_id 对应的一个 open_id（发 DM 时用），无则返回 null */
  getOpenIdForUnionId(unionId: string): string | null {
    const ids = this.getOpenIdsByUnionId(unionId);
    return ids[0] ?? null;
  }

  all(): Map<string, FeishuIdEntry> {
    return new Map(this.map);
  }
}
