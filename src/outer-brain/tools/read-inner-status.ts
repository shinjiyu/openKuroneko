/**
 * read_inner_status — 读取内脑当前状态快照
 *
 * 从 <innerTempDir>/status 文件读取 JSON。
 * 内脑每轮 tick 更新该文件。
 */

import fs from 'node:fs';
import type { ObTool } from './types.js';

export function createReadInnerStatusTool(innerTempDir: string): ObTool {
  const statusFile = `${innerTempDir}/status`;

  return {
    name: 'read_inner_status',
    description:
      '读取内脑（任务执行 agent）当前状态。返回当前模式、正在执行的里程碑、是否 BLOCK 及 BLOCK 原因。',
    parameters: {},
    async call(): Promise<{ ok: boolean; output: string }> {
      if (!fs.existsSync(statusFile)) {
        return { ok: true, output: '内脑尚未启动或状态文件不存在。' };
      }
      try {
        const raw = fs.readFileSync(statusFile, 'utf8').trim();
        const status = JSON.parse(raw) as Record<string, unknown>;
        return {
          ok: true,
          output: JSON.stringify(status, null, 2),
        };
      } catch {
        return { ok: false, output: '状态文件解析失败。' };
      }
    },
  };
}
