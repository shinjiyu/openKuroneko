/**
 * Agent 共享池：外脑技能池；创建内脑时按目标选择相关技能注入，结束时归档回池。
 * 协议：doc/protocols/agent-pool.md
 */

import fs from 'node:fs';
import path from 'node:path';

import type { SkillEntry } from '../brain/brain-fs.js';
import type { Logger } from '../logger/index.js';

const SKILLS_INDEX_HEADER = '# skills index: id\tcategory\ttitle\ttags\tts\n';

/** 简单分词：与 BrainFS 检索一致，用于相关性打分 */
function tokenize(text: string): Set<string> {
  const STOP = new Set(['的', '了', '在', '是', '和', '或', '与', '等', '及', 'the', 'a', 'an', 'to', 'of', 'for', 'in', 'on', 'at', 'by']);
  const words = new Set<string>();
  for (const w of text.toLowerCase().split(/[\s,，、；;:：\-_/\\[\]()（）]+/)) {
    if (w.length > 1 && !STOP.has(w)) words.add(w);
  }
  const cjk = text.replace(/[^\u4e00-\u9fff]/g, '');
  for (let i = 0; i < cjk.length - 1; i++) {
    const gram = cjk.slice(i, i + 2);
    if (!STOP.has(gram)) words.add(gram);
  }
  return words;
}

export function parseSkillIndex(raw: string): SkillEntry[] {
  if (!raw.trim()) return [];
  return raw.split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('//'))
    .map(l => {
      const [id, category, title, tagsStr, ts] = l.split('\t');
      if (!id || !category || !title) return null;
      return {
        id: id.trim(),
        category: category.trim(),
        title: title.trim(),
        tags: (tagsStr ?? '').split(',').map(t => t.trim()).filter(Boolean),
        ts: (ts ?? '').trim(),
      } as SkillEntry;
    })
    .filter((e): e is SkillEntry => e !== null);
}

/** Agent 池 .brain 目录：<obDir>/agent-pool/.brain */
export function getAgentPoolBrainDir(obDir: string): string {
  return path.join(obDir, 'agent-pool', '.brain');
}

/**
 * 从外脑池中按 goal 做相关性选择，返回 topK 条最相关技能。
 * 算法：goal 分词后与每条技能的 title+tags+category 做词重叠打分。
 */
export function selectRelevantSkills(poolBrainDir: string, goal: string, topK = 5): SkillEntry[] {
  const poolIndex = path.join(poolBrainDir, 'skills.md');
  if (!fs.existsSync(poolIndex)) return [];
  const raw = fs.readFileSync(poolIndex, 'utf8');
  const entries = parseSkillIndex(raw);
  if (entries.length === 0) return [];

  const queryWords = tokenize(goal);
  if (queryWords.size === 0) return entries.slice(0, topK);

  const scored = entries.map(entry => {
    const entryWords = new Set([
      ...tokenize(entry.title),
      ...entry.tags.flatMap(t => tokenize(t)),
      ...tokenize(entry.category),
    ]);
    let score = 0;
    for (const w of queryWords) {
      if (entryWords.has(w)) score++;
    }
    return { entry, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.entry);
}

/**
 * 创建内脑时：按 goal 选择相关技能，仅将选中技能注入 workDir/.brain/。
 * 池不存在或选择结果为空则跳过（不写入 skills）。
 */
export function seedRelevantSkillsToWorkDir(obDir: string, workDir: string, goal: string, topK = 5): void {
  const poolBrain = getAgentPoolBrainDir(obDir);
  const selected = selectRelevantSkills(poolBrain, goal, topK);
  if (selected.length === 0) return;

  const poolSkillsDir = path.join(poolBrain, 'skills');
  const workBrain = path.join(workDir, '.brain');
  fs.mkdirSync(workBrain, { recursive: true });
  const workSkillsDir = path.join(workBrain, 'skills');

  for (const e of selected) {
    const src = path.join(poolSkillsDir, e.category, `${e.id}.md`);
    if (!fs.existsSync(src)) continue;
    const destCat = path.join(workSkillsDir, e.category);
    fs.mkdirSync(destCat, { recursive: true });
    fs.copyFileSync(src, path.join(destCat, `${e.id}.md`));
  }

  const indexLines = [SKILLS_INDEX_HEADER];
  for (const e of selected) {
    indexLines.push([e.id, e.category, e.title, e.tags.join(','), e.ts].join('\t') + '\n');
  }
  fs.writeFileSync(path.join(workBrain, 'skills.md'), indexLines.join(''), 'utf8');
}

/**
 * 将 workDir/.brain/skills 合并到 agent 池。实例退出时调用。
 * 按 id 合并：池中无则添加，有则仅当实例 ts 不早于池中时覆盖。
 */
export function mergeWorkDirSkillsToAgentPool(
  obDir: string,
  workDir: string,
  logger?: Logger,
): void {
  const workBrain = path.join(workDir, '.brain');
  const workIndexPath = path.join(workBrain, 'skills.md');
  const workSkillsDir = path.join(workBrain, 'skills');

  if (!fs.existsSync(workIndexPath)) return;
  const raw = fs.readFileSync(workIndexPath, 'utf8');
  const workEntries = parseSkillIndex(raw);
  if (workEntries.length === 0) return;

  const poolBrain = getAgentPoolBrainDir(obDir);
  fs.mkdirSync(poolBrain, { recursive: true });
  const poolIndexPath = path.join(poolBrain, 'skills.md');
  const poolSkillsDir = path.join(poolBrain, 'skills');

  const poolRaw = fs.existsSync(poolIndexPath) ? fs.readFileSync(poolIndexPath, 'utf8') : '';
  const poolEntries = parseSkillIndex(poolRaw);
  const poolById = new Map<string, SkillEntry>(poolEntries.map(e => [e.id, e]));

  for (const e of workEntries) {
    const existing = poolById.get(e.id);
    if (existing && e.ts < existing.ts) continue; // 实例更旧，不覆盖
    const srcFile = path.join(workSkillsDir, e.category, `${e.id}.md`);
    if (!fs.existsSync(srcFile)) continue;
    const destCategoryDir = path.join(poolSkillsDir, e.category);
    fs.mkdirSync(destCategoryDir, { recursive: true });
    fs.copyFileSync(srcFile, path.join(destCategoryDir, `${e.id}.md`));
    poolById.set(e.id, e);
  }

  const indexLines = [SKILLS_INDEX_HEADER];
  for (const e of poolById.values()) {
    indexLines.push([e.id, e.category, e.title, e.tags.join(','), e.ts].join('\t') + '\n');
  }
  fs.writeFileSync(poolIndexPath, indexLines.join(''), 'utf8');

  logger?.info('outer-brain', {
    event: 'agent-pool.merge',
    data: { obDir, workDir, merged: workEntries.length, poolTotal: poolById.size },
  });
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
