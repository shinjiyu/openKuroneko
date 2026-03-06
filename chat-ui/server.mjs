/**
 * chat-ui/server.mjs — pi-mono 任务监控面板服务
 *
 * 启动方式：
 *   node --env-file=.env chat-ui/server.mjs
 *
 * 环境变量：
 *   CHAT_PORT=3000           监听端口
 *   CHAT_GOAL="..."          传递给 Agent 的目标文本（--goal）
 *   CHAT_GOAL_FILE=path      传递给 Agent 的 goal 文件路径（--goal-file，优先于 CHAT_GOAL）
 *   CHAT_RESET=true          启动时清空 temp 目录（测试用）
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

// ── Agent identity（与 identity.ts 保持一致）─────────────────────────────────

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
const BRAIN_DIR   = path.join(AGENT_DIR, '.brain');

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

// ── .brain/ 文件监控 ──────────────────────────────────────────────────────────

const BRAIN_FILES = ['goal.md', 'milestones.md', 'constraints.md', 'knowledge.md', 'skills.md', 'environment.md', 'controller-state.json'];
const brainCache = {};

function readBrain() {
  const result = {};
  for (const f of BRAIN_FILES) {
    const fp = path.join(BRAIN_DIR, f);
    result[f] = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
  }
  return result;
}

function startWatchers() {
  // 每 500ms 轮询 output 文件
  setInterval(() => {
    try {
      if (!fs.existsSync(OUTPUT_FILE)) return;
      const content = fs.readFileSync(OUTPUT_FILE, 'utf8').trim();
      if (content) {
        broadcast('output', content);
        fs.truncateSync(OUTPUT_FILE, 0);
      }
    } catch { /* ignore */ }
  }, 500);

  // 每 300ms tail 日志
  let logSize = 0;
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
        try { broadcast('log', JSON.parse(t)); } catch { /* skip */ }
      }
    } catch { /* ignore */ }
  }, 300);

  // 每 2s 轮询 .brain/ 文件变化
  setInterval(() => {
    try {
      const brain = readBrain();
      let changed = false;
      for (const [k, v] of Object.entries(brain)) {
        if (brainCache[k] !== v) { brainCache[k] = v; changed = true; }
      }
      if (changed) broadcast('brain', brain);
    } catch { /* ignore */ }
  }, 2000);
}

// ── 初始化目录 ────────────────────────────────────────────────────────────────

function setupDirs() {
  const reset = process.env.CHAT_RESET === 'true';

  if (reset) {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
      console.log(`[monitor] Reset: cleared ${TEMP_DIR}`);
    }
    const lockFile = path.join(GLOBAL_TMP, `${agentId}.lock`);
    if (fs.existsSync(lockFile)) {
      fs.rmSync(lockFile, { force: true });
      console.log(`[monitor] Reset: removed lock ${lockFile}`);
    }
  }

  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEMP_DIR, 'logs'), { recursive: true });
}

// ── 启动 Agent 进程 ───────────────────────────────────────────────────────────

function startAgent() {
  const agentBin = path.join(ROOT, 'dist', 'cli', 'index.js');
  if (!fs.existsSync(agentBin)) {
    console.error(`[monitor] ERROR: dist not found at ${agentBin}`);
    console.error('[monitor] Run "npm run build" first.');
    process.exit(1);
  }

  const args = [agentBin, '--dir', AGENT_DIR, '--loop', 'fast'];

  // goal 优先级: CHAT_GOAL_FILE > CHAT_GOAL > (none, agent will BLOCK)
  if (process.env.CHAT_GOAL_FILE) {
    args.push('--goal-file', process.env.CHAT_GOAL_FILE);
  } else if (process.env.CHAT_GOAL) {
    args.push('--goal', process.env.CHAT_GOAL);
  }

  const agentProc = spawn('node', args, {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: ROOT,
  });

  agentProc.stdout.on('data', d => process.stdout.write(d));
  agentProc.stderr.on('data', d => process.stderr.write(d));
  agentProc.on('exit', code => {
    console.error(`[monitor] Agent exited (code=${code})`);
    broadcast('log', { level: 'error', module: 'cli', event: 'agent.exited', data: { code } });
  });

  console.log(`[monitor] Agent started  pid=${agentProc.pid}`);
  console.log(`[monitor] agentId        ${agentId}`);
  console.log(`[monitor] tempDir        ${TEMP_DIR}`);
  console.log(`[monitor] brainDir       ${BRAIN_DIR}`);
  return agentProc;
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    // Send initial state
    const brain = readBrain();
    res.write(`data: ${JSON.stringify({ type: 'connected', data: { agentId, tempDir: TEMP_DIR } })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'brain', data: brain })}\n\n`);
    clients.add(res);
    const ka = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch { clearInterval(ka); clients.delete(res); }
    }, 15_000);
    req.on('close', () => { clearInterval(ka); clients.delete(res); });
    return;
  }

  // POST /send — 写 input（用于 BLOCK 状态下的外脑响应）
  if (req.method === 'POST' && url.pathname === '/send') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { message } = JSON.parse(body);
        if (typeof message === 'string' && message.trim()) {
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

// ── Main ──────────────────────────────────────────────────────────────────────

setupDirs();
const agentProc = startAgent();
startWatchers();

process.on('SIGINT',  () => { agentProc.kill(); process.exit(0); });
process.on('SIGTERM', () => { agentProc.kill(); process.exit(0); });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n[monitor] ✓ Open http://localhost:${PORT}\n`);
});
