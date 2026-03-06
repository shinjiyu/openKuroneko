/**
 * migrate-skills.mjs
 *
 * 将旧格式 .brain/skills.md（每条用 <!-- ts --> 分隔，无结构）
 * 迁移到新格式：
 *   .brain/skills/<category>/<id>.md   完整内容
 *   .brain/skills.md                   TSV 目录索引
 *
 * 用法：
 *   node scripts/migrate-skills.mjs [--dir <workDir>] [--dry-run]
 *
 * 分类规则（基于关键词启发式匹配）：
 *   browser  → playwright, 浏览器, browser, headless, login, 登录, cookies
 *   web      → web_search, fetch, search, 搜索, 抓取, 爬取, http, url
 *   file     → read_file, write_file, edit_file, 目录, 文件, 扫描, 结构
 *   shell    → shell_exec, npm, pip, git, 命令, 脚本, 安装
 *   code     → 代码, 调试, 修复, bug, test, 测试, 编程
 *   data     → 数据, 分析, 格式, json, csv, 报告, 报表
 *   agent    → run_agent, 子agent, 协调, 任务分发
 *   general  → （其余）
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const dirIdx = args.indexOf('--dir');
const workDir = dirIdx >= 0 && args[dirIdx + 1]
  ? path.resolve(args[dirIdx + 1])
  : path.resolve(process.cwd(), 'chat-agent');

const brainDir = path.join(workDir, '.brain');
const oldSkillsFile = path.join(brainDir, 'skills.md');

if (!fs.existsSync(oldSkillsFile)) {
  console.log(`No skills.md found at ${oldSkillsFile}`);
  process.exit(0);
}

// ── 分类规则 ──────────────────────────────────────────────────────────────────

const CATEGORY_RULES = [
  { cat: 'browser', kw: ['playwright', '浏览器', 'browser', 'headless', 'login', '登录', 'cookies', 'auth', 'page.'] },
  { cat: 'web',     kw: ['web_search', 'fetch', '搜索', '抓取', '爬取', 'http', 'url', 'site:', 'duckduckgo', 'ddg'] },
  { cat: 'file',    kw: ['read_file', 'write_file', 'edit_file', '目录', '文件', '扫描', '结构', 'find .', 'ls '] },
  { cat: 'shell',   kw: ['shell_exec', 'npm ', 'pip ', 'git ', '命令', '脚本', '安装', 'node ', 'python '] },
  { cat: 'code',    kw: ['代码', '调试', '修复', 'bug', 'test', '测试', '编程', 'assert', 'import '] },
  { cat: 'data',    kw: ['数据', '分析', '格式', 'json', 'csv', '报告', '报表', '统计'] },
  { cat: 'agent',   kw: ['run_agent', '子agent', '子 agent', '协调', '任务分发', 'list_agents'] },
];

function detectCategory(text) {
  const lower = text.toLowerCase();
  let best = 'general';
  let bestScore = 0;
  for (const { cat, kw } of CATEGORY_RULES) {
    const score = kw.filter(k => lower.includes(k.toLowerCase())).length;
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best;
}

// ── 提取标题（取内容第一行非空文字，清理 markdown） ─────────────────────────

function extractTitle(content) {
  for (const line of content.split('\n')) {
    const t = line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim();
    if (t.length > 4 && t.length < 80) {
      // 优先找「场景：」行
      if (t.startsWith('场景：') || t.startsWith('场景:')) {
        return t.replace(/^场景[：:]/, '').trim().slice(0, 60);
      }
      return t.slice(0, 60);
    }
  }
  return '未命名技能';
}

// ── 提取标签（扫描内容里的工具名 + 关键中文词） ──────────────────────────────

const TAG_PATTERNS = [
  /web_search|read_file|write_file|edit_file|shell_exec|playwright|run_agent/g,
  /微博|登录|浏览器|搜索|抓取|文件|扫描|安装|报告|cookies/g,
];

function extractTags(content) {
  const found = new Set();
  for (const pat of TAG_PATTERNS) {
    for (const m of content.matchAll(pat)) found.add(m[0]);
  }
  return [...found].slice(0, 8);
}

// ── 解析旧 skills.md ──────────────────────────────────────────────────────────

const raw = fs.readFileSync(oldSkillsFile, 'utf8');

// 如果已经是新格式（TSV 索引），跳过
if (raw.startsWith('# skills index:')) {
  console.log('skills.md 已是新格式，无需迁移。');
  process.exit(0);
}

// 按 <!-- ts --> 分隔
const chunks = raw.split(/\n<!-- [^>]+ -->\n/).map(c => c.trim()).filter(Boolean);
console.log(`找到 ${chunks.length} 条旧技能，开始迁移...`);

if (isDryRun) {
  console.log('[DRY RUN] 不写入文件');
}

// 备份旧文件
const backupPath = oldSkillsFile + '.bak';
if (!isDryRun) {
  fs.copyFileSync(oldSkillsFile, backupPath);
  console.log(`旧文件已备份到 ${backupPath}`);
}

// 写新索引头
const indexLines = ['# skills index: id\tcategory\ttitle\ttags\tts'];

let count = 0;
for (const chunk of chunks) {
  const category = detectCategory(chunk);
  const title = extractTitle(chunk);
  const tags = extractTags(chunk);
  const id = 's-' + crypto.randomBytes(3).toString('hex');
  const ts = new Date().toISOString();

  const skillsDir = path.join(brainDir, 'skills', category);
  const skillFile = path.join(skillsDir, `${id}.md`);
  const fileContent = `# ${title}\n\n> category: ${category} | id: ${id} | ${ts}\n\n${chunk}\n`;

  if (!isDryRun) {
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(skillFile, fileContent, 'utf8');
  }

  indexLines.push([id, category, title, tags.join(','), ts].join('\t'));
  count++;

  if (isDryRun || count <= 5) {
    console.log(`  [${count}] ${category}/${id} | ${title.slice(0, 40)} | tags: ${tags.join(',')}`);
  }
}

if (isDryRun) {
  console.log(`\n[DRY RUN] 共会迁移 ${count} 条技能，分类统计见上`);
} else {
  // 写新 skills.md 索引
  fs.writeFileSync(oldSkillsFile, indexLines.join('\n') + '\n', 'utf8');
  console.log(`\n✅ 迁移完成：${count} 条技能 → .brain/skills/<category>/<id>.md`);
  console.log(`   索引已更新：${oldSkillsFile}`);
  console.log(`   旧文件备份：${backupPath}`);

  // 统计各分类数量
  const catCount = {};
  for (const line of indexLines.slice(1)) {
    const cat = line.split('\t')[1];
    catCount[cat] = (catCount[cat] || 0) + 1;
  }
  console.log('\n分类统计：');
  for (const [cat, n] of Object.entries(catCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${n} 条`);
  }
}
