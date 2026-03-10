/**
 * Soul — 人格文件加载器（soul.md 热载）
 *
 * soul.md 定义外脑人设，热载支持：文件变更时自动重载，无需重启进程。
 *
 * 建议的 soul.md 结构（YAML front-matter + Markdown body）：
 * ---
 * name: （可选；不设则由渠道提供，如飞书应用名）
 * persona: 专业、简洁、有温度
 * language: zh-CN
 * participation:
 *   proactive_level: 2   # 0=沉默 1=谨慎 2=正常 3=活跃
 *   speak_cooldown_ms: 60000
 *   max_proactive_per_5min: 3
 * owner_users:
 *   - alice
 * ---
 * 人格描述正文（勿在此写死身份名，身份由当前渠道如飞书应用名提供）...
 */

import fs from 'node:fs';
import type { Logger } from '../logger/index.js';

export interface SoulConfig {
  /** 人格名（可选）；有渠道展示名时以渠道为准，便于用户说「黑猫」时 agent 识别为自己 */
  name: string;
  persona: string;
  language: string;
  participation: {
    proactive_level: number;   // 0-3
    speak_cooldown_ms: number;
    max_proactive_per_5min: number;
  };
  owner_users: string[];
  /** 完整 soul.md body（去除 front-matter）作为系统提示补充 */
  system_prompt_extra: string;
  /** 原始 soul.md 完整内容 */
  raw: string;
}

const DEFAULTS: SoulConfig = {
  name: '',
  persona: '27 岁女性程序员，专业、简洁、有温度',
  language: 'zh-CN',
  participation: {
    proactive_level: 3,
    speak_cooldown_ms: 45_000,
    max_proactive_per_5min: 6,
  },
  owner_users: [],
  system_prompt_extra: '',
  raw: '',
};

export class SoulLoader {
  private readonly soulPath: string;
  private readonly logger: Logger;
  private current: SoulConfig = { ...DEFAULTS };
  private watcher: fs.FSWatcher | null = null;

  constructor(soulPath: string, logger: Logger) {
    this.soulPath = soulPath;
    this.logger   = logger;
    this.reload();
  }

  get(): SoulConfig {
    return this.current;
  }

  /** 开启文件监听，变更时自动热载 */
  watch(): void {
    if (this.watcher) return;
    try {
      this.watcher = fs.watch(this.soulPath, () => {
        this.reload();
        this.logger.info('soul', { event: 'soul.reload', data: { path: this.soulPath } });
      });
    } catch { /* file may not exist yet */ }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  private reload(): void {
    if (!fs.existsSync(this.soulPath)) {
      this.current = { ...DEFAULTS };
      return;
    }

    try {
      const raw = fs.readFileSync(this.soulPath, 'utf8');
      this.current = parseSoul(raw);
    } catch (e) {
      this.logger.warn('soul', { event: 'soul.parse_error', data: { error: String(e) } });
    }
  }
}

// ── YAML front-matter 解析（轻量，不依赖 yaml 库）────────────────────────────

function parseSoul(raw: string): SoulConfig {
  const result: SoulConfig = { ...DEFAULTS, raw };

  // 提取 front-matter
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    result.system_prompt_extra = raw;
    return result;
  }

  const fm   = fmMatch[1] ?? '';
  const body = (fmMatch[2] ?? '').trim();
  result.system_prompt_extra = body;

  // 逐行解析 YAML（仅支持简单 key: value 和嵌套 key: value 两层）
  const lines = fm.split('\n');
  let currentParent = '';

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const nestedMatch = line.match(/^  (\w+):\s*(.*)/);
    const topMatch    = line.match(/^(\w+):\s*(.*)/);
    const listMatch   = line.match(/^  -\s+(.*)/);

    if (nestedMatch && currentParent) {
      const [, key, val] = nestedMatch;
      setNestedValue(result, currentParent, key ?? '', val ?? '');
    } else if (listMatch && currentParent === 'owner_users') {
      result.owner_users.push((listMatch[1] ?? '').trim());
    } else if (topMatch) {
      const [, key, val] = topMatch;
      currentParent = key ?? '';
      if (val?.trim()) {
        setTopValue(result, key ?? '', val.trim());
      } else if (key === 'owner_users') {
        result.owner_users = [];
      }
    }
  }

  return result;
}

function setTopValue(result: SoulConfig, key: string, val: string): void {
  switch (key) {
    case 'name':    result.name = val; break;
    case 'persona': result.persona = val; break;
    case 'language': result.language = val; break;
  }
}

function setNestedValue(result: SoulConfig, parent: string, key: string, val: string): void {
  if (parent === 'participation') {
    switch (key) {
      case 'proactive_level':       result.participation.proactive_level = parseInt(val, 10) || 2; break;
      case 'speak_cooldown_ms':     result.participation.speak_cooldown_ms = parseInt(val, 10) || 60000; break;
      case 'max_proactive_per_5min': result.participation.max_proactive_per_5min = parseInt(val, 10) || 3; break;
    }
  }
}
