/**
 * 飞书用户身份列表（供内脑读取：union_id / open_id / 用户名 对应关系）
 *
 * 在 onFeishuIdsSeen 合并映射后调用 writeFeishuIdentitiesFile，将当前
 * UserStore + FeishuOpenIdMap 中与飞书相关的用户写成 obDir/feishu-identities.json，
 * 内脑可通过该文件知道「谁是谁」。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { UserStore } from './store.js';
import type { FeishuOpenIdMap } from './feishu-openid-map.js';

export type FeishuIdentityRow = {
  user_id: string;
  display_name: string;
  union_id: string | null;
  open_id: string | null;
};

/**
 * 将当前飞书相关用户（user_id、展示名、union_id、open_id）写入 obDir/feishu-identities.json。
 * 内脑可读取此文件以获知 union_id ↔ open_id ↔ 用户名的关系。
 */
export function writeFeishuIdentitiesFile(
  obDir: string,
  userStore: UserStore,
  feishuOpenIdMap: FeishuOpenIdMap,
): void {
  const rows: FeishuIdentityRow[] = [];
  const map = feishuOpenIdMap.all();

  for (const user of userStore.allUsers()) {
    const feishuBinding = user.channels.find((c) => c.channel_id === 'feishu');
    if (!feishuBinding) continue;

    const rawId = feishuBinding.raw_id;
    const isUnionId = rawId.startsWith('on_');
    const openId = isUnionId ? feishuOpenIdMap.getOpenIdForUnionId(rawId) : rawId;
    const unionId = isUnionId ? rawId : (map.get(openId ?? '')?.union_id ?? null);
    const name = feishuOpenIdMap.getDisplayName(rawId) ?? user.display_name ?? rawId;

    rows.push({
      user_id: user.user_id,
      display_name: name,
      union_id: unionId ?? null,
      open_id: openId ?? null,
    });
  }

  const filePath = path.join(obDir, 'feishu-identities.json');
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf8');
}
