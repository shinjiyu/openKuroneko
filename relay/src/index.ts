/**
 * 消息中转服务器
 *
 * 飞书插件连接后注册 agent_id，本端发群消息后上报 speak，服务器向其它已注册连接广播。
 * 鉴权：单一 RELAY_KEY，客户端带 key 建连/首包，一致则接受。
 *
 * 配置：RELAY_KEY（必填）, PORT（可选，默认 9090）
 */

import { WebSocketServer } from 'ws';

const RELAY_KEY = process.env['RELAY_KEY'] ?? '';
const PORT = parseInt(process.env['PORT'] ?? '9090', 10);

if (!RELAY_KEY) {
  console.error('RELAY_KEY is required');
  process.exit(1);
}

interface AgentConnection {
  agentId: string;
  ws: import('ws').WebSocket;
  registeredAt: number;
}

const connections = new Map<string, AgentConnection>();

function broadcast(excludeAgentId: string, payload: object): void {
  const raw = JSON.stringify(payload);
  for (const [agentId, conn] of connections) {
    if (agentId === excludeAgentId) continue;
    if (conn.ws.readyState === 1) {
      try {
        conn.ws.send(raw);
      } catch {
        // ignore
      }
    }
  }
}

function parseMessage(data: Buffer | string): unknown {
  const str = typeof data === 'string' ? data : data.toString('utf8');
  try {
    return JSON.parse(str) as unknown;
  } catch {
    return null;
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws, req) => {
  let agentId: string | null = null;

  ws.on('message', (raw) => {
    const msg = parseMessage(raw as Buffer);
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;

    const type = (msg as { type?: string }).type;

    if (type === 'register') {
      const { key, agent_id } = msg as { key?: string; agent_id?: string };
      if (key !== RELAY_KEY || !agent_id) {
        ws.send(JSON.stringify({ type: 'error', message: 'invalid key or missing agent_id' }));
        ws.close();
        return;
      }
      agentId = agent_id;
      connections.set(agent_id, { agentId: agent_id, ws, registeredAt: Date.now() });
      ws.send(JSON.stringify({ type: 'registered', agent_id: agent_id }));
      return;
    }

    if (!agentId) {
      ws.send(JSON.stringify({ type: 'error', message: 'send register first' }));
      return;
    }

    if (type === 'speak') {
      const { thread_id, content, ts, message_id } = msg as {
        thread_id?: string;
        content?: string;
        ts?: number;
        message_id?: string;
      };
      if (!thread_id || content === undefined) return;
      broadcast(agentId, {
        type:       'broadcast',
        thread_id,
        sender_agent_id: agentId,
        content:    content ?? '',
        ts:         typeof ts === 'number' ? ts : Date.now(),
        message_id: message_id ?? undefined,
      });
    }
  });

  ws.on('close', () => {
    if (agentId) connections.delete(agentId);
  });
});

wss.on('listening', () => {
  console.log(`[relay] listening on port ${PORT}`);
});
