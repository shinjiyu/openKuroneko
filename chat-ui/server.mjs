/**
 * chat-ui/server.mjs
 *
 * 启动方式（Node.js 20+，会自动加载 .env）：
 *   node --env-file=.env chat-ui/server.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(path.join(__dirname, '..'));
const PORT = parseInt(process.env.CHAT_PORT ?? '3000', 10);

// ── Agent identity（与 identity.ts 保持一致）────────────────────────────────

function getMac() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00')
        return iface.mac;
    }
  }
  return '00:00:00:00:00:00';
}

const AGENT_DIR   = path.resolve(path.join(ROOT, 'chat-agent'));
const GLOBAL_TMP  = process.env.OPENKURONEKO_TMP ?? path.join(os.tmpdir(), 'openkuroneko');
const agentId     = crypto.createHash('sha256')
  .update(`${getMac()}::${AGENT_DIR}`)
  .digest('hex')
  .slice(0, 16);
const TEMP_DIR    = path.join(GLOBAL_TMP, agentId);
const INPUT_FILE  = path.join(TEMP_DIR, 'input');
const OUTPUT_FILE = path.join(TEMP_DIR, 'output');

function todayLogFile() {
  return path.join(TEMP_DIR, 'logs', `${new Date().toISOString().slice(0, 10)}.jsonl`);
}

// ── SSE 客户端管理 ────────────────────────────────────────────────────────────

const clients = new Set();

function broadcast(type, data) {
  const msg = `data: ${JSON.stringify({ type, data })}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch { clients.delete(res); }
  }
}

// ── 文件监听 ──────────────────────────────────────────────────────────────────

let logSize = 0;

function startWatchers() {
  // output 文件：每 500ms 轮询，有内容即消费并广播
  setInterval(() => {
    try {
      if (!fs.existsSync(OUTPUT_FILE)) return;
      const content = fs.readFileSync(OUTPUT_FILE, 'utf8').trim();
      if (content) {
        broadcast('agent', content);
        fs.truncateSync(OUTPUT_FILE, 0);
      }
    } catch { /* ignore */ }
  }, 500);

  // 日志文件：每 300ms tail 新增行
  setInterval(() => {
    try {
      const logFile = todayLogFile();
      if (!fs.existsSync(logFile)) return;
      const stat = fs.statSync(logFile);
      if (stat.size <= logSize) return;
      const fd = fs.openSync(logFile, 'r');
      const buf = Buffer.alloc(stat.size - logSize);
      fs.readSync(fd, buf, 0, buf.length, logSize);
      fs.closeSync(fd);
      logSize = stat.size;
      for (const line of buf.toString('utf8').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try { broadcast('log', JSON.parse(t)); } catch { /* skip malformed */ }
      }
    } catch { /* ignore */ }
  }, 300);
}

// ── 初始化 agent 目录和 soul ─────────────────────────────────────────────────

const CHAT_SOUL = `# Chat Agent Soul

## 角色定位
你是一个友好、智能的 AI 聊天助手，运行于 openKuroneko 框架中。

## 消息格式
输入消息有两种形式：

**形式 A — 有 master 消息（需要回复）**
\`\`\`
<master_message>
用户的实际内容
</master_message>
\`\`\`
→ 看到 <master_message> 标签，说明有真实用户在等待回复，**必须调用 reply_to_master 工具**将回复发送出去。

**形式 B — 系统控制指令（无需回复）**
\`\`\`
[SCL control prompt] No new input...
\`\`\`
→ 没有 <master_message> 标签，这是系统内部调度指令，**禁止调用 reply_to_master，禁止输出任何内容**，直接结束本轮。

## 工具使用规则
1. 收到 <master_message> 时：理解内容 → 可调用 web_search/shell_exec 等辅助工具 → 最后**必须**调用 reply_to_master 回复。
2. 收到系统控制指令时：不调用任何工具，静默结束。
3. 文件路径**必须使用相对路径**（如 "snake.html"、"src/index.js"），不要使用绝对路径。所有文件操作都在 Working Directory 下进行。

## 输出风格
- 默认使用中文（用户用其他语言则跟随切换）
- 简洁直接，使用 Markdown 格式化代码、列表等复杂内容
`.trim();

function setupAgent() {
  const reset = process.env.CHAT_RESET === 'true';

  if (reset) {
    // Clear temp dir (memory, logs, soul)
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
      console.log(`[chat-ui] Reset: cleared ${TEMP_DIR}`);
    }
    // Clear stale lock file so agent can acquire it cleanly
    const lockFile = path.join(GLOBAL_TMP, `${agentId}.lock`);
    if (fs.existsSync(lockFile)) {
      fs.rmSync(lockFile, { force: true });
      console.log(`[chat-ui] Reset: removed lock ${lockFile}`);
    }
  }

  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEMP_DIR, 'logs'), { recursive: true });

  // Always write soul on reset; create only if missing otherwise
  const soulPath = path.join(TEMP_DIR, 'soul.md');
  if (reset || !fs.existsSync(soulPath)) {
    fs.writeFileSync(soulPath, CHAT_SOUL, 'utf8');
    console.log(`[chat-ui] soul.md written to ${soulPath}`);
  }
}

// ── 启动 Agent 进程 ───────────────────────────────────────────────────────────

function startAgent() {
  const agentBin = path.join(ROOT, 'dist', 'cli', 'index.js');
  if (!fs.existsSync(agentBin)) {
    console.error(`[chat-ui] ERROR: dist not found at ${agentBin}`);
    console.error('[chat-ui] Run "npm run build" first.');
    process.exit(1);
  }

  const agentProc = spawn('node', [agentBin, '--dir', AGENT_DIR, '--loop', 'fast'], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: ROOT,
  });

  agentProc.stdout.on('data', d => process.stdout.write(d));
  agentProc.stderr.on('data', d => process.stderr.write(d));
  agentProc.on('exit', code => {
    console.error(`[chat-ui] Agent exited (code=${code})`);
    broadcast('log', { level: 'error', module: 'cli', event: 'agent.exited', data: { code } });
  });

  console.log(`[chat-ui] Agent started  pid=${agentProc.pid}`);
  console.log(`[chat-ui] agentId        ${agentId}`);
  console.log(`[chat-ui] tempDir        ${TEMP_DIR}`);
  return agentProc;
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── GET / → HTML ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  // ── GET /events → SSE ─────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', data: { agentId, tempDir: TEMP_DIR } })}\n\n`);
    clients.add(res);
    const ka = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch { clearInterval(ka); clients.delete(res); }
    }, 15_000);
    req.on('close', () => { clearInterval(ka); clients.delete(res); });
    return;
  }

  // ── POST /send → write input ───────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/send') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { message } = JSON.parse(body);
        if (typeof message === 'string' && message.trim()) {
          // Append so incremental offset-based reading in the agent picks up only new bytes
          fs.appendFileSync(INPUT_FILE, message.trim() + '\n', 'utf8');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// ── Main ─────────────────────────────────────────────────────────────────────

setupAgent();
const agentProc = startAgent();
startWatchers();

process.on('SIGINT',  () => { agentProc.kill(); process.exit(0); });
process.on('SIGTERM', () => { agentProc.kill(); process.exit(0); });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n[chat-ui] ✓ Open http://localhost:${PORT}\n`);
});
