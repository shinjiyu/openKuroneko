/**
 * write_skill — Attributor 专用工具
 * 向 .brain/skills.md 追加一条可复用的技能范式。
 */

import fs from 'node:fs';
import path from 'node:path';
import { getWorkDir } from './workdir-guard.js';
import type { Tool } from '../index.js';

export const writeSkillTool: Tool = {
  name: 'write_skill',
  description:
    '向 .brain/skills.md 追加一条可复用的成功操作模式（技能）。' +
    '仅在归因阶段调用，当本次执行中有可复用的解决方案时调用。\n' +
    '格式：\n' +
    '  场景：<遇到什么情况>\n' +
    '  步骤：<有效的操作序列>\n' +
    '  验证：<如何确认成功>',
  parameters: {
    content: {
      type: 'string',
      description: '技能描述，包含「场景/步骤/验证」三段',
    },
  },
  required: ['content'],
  async call(args) {
    const content = String(args['content'] ?? '').trim();
    if (!content) return { ok: false, output: '缺少必需参数: content' };

    const brainDir = path.join(getWorkDir(), '.brain');
    const filePath = path.join(brainDir, 'skills.md');
    try {
      fs.mkdirSync(brainDir, { recursive: true });
      const ts = new Date().toISOString();
      const entry = `\n<!-- ${ts} -->\n${content}\n`;
      fs.appendFileSync(filePath, entry, 'utf8');
      return { ok: true, output: `技能已记录到 .brain/skills.md` };
    } catch (e) {
      return { ok: false, output: String(e) };
    }
  },
};
