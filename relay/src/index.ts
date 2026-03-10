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

function connectionIds(): string[] {
  return Array.from(connections.keys()).sort();
}

function broadcast(excludeAgentId: string, payload: object): number {
  const raw = JSON.stringify(payload);
  let sent = 0;
  for (const [agentId, conn] of connections) {
    if (agentId === excludeAgentId) continue;
    if (conn.ws.readyState === 1) {
      try {
        conn.ws.send(raw);
        sent++;
        console.log(`[relay] broadcast sent to agent_id=${agentId}`);
      } catch (e) {
        console.log(`[relay] broadcast send failed agent_id=${agentId} error=${String(e)}`);
      }
    } else {
      console.log(`[relay] broadcast skip agent_id=${agentId} readyState=${conn.ws.readyState}`);
    }
  }
  return sent;
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
  const remote = req.socket?.remoteAddress ?? 'unknown';
  console.log(`[relay] connection open remote=${remote} (waiting register)`);
  let agentId: string | null = null;

  ws.on('message', (raw) => {
    const msg = parseMessage(raw as Buffer);
    if (!msg || typeof msg !== 'object' || !('type' in msg)) {
      console.log(`[relay] message ignored (invalid or missing type)`);
      return;
    }

    const type = (msg as { type?: string }).type;

    if (type === 'register') {
      const { key, agent_id } = msg as { key?: string; agent_id?: string };
      if (key !== RELAY_KEY || !agent_id) {
        console.log(`[relay] register rejected agent_id=${agent_id ?? 'missing'} key_ok=${key === RELAY_KEY}`);
        ws.send(JSON.stringify({ type: 'error', message: 'invalid key or missing agent_id' }));
        ws.close();
        return;
      }
      agentId = agent_id;
      connections.set(agent_id, { agentId: agent_id, ws, registeredAt: Date.now() });
      ws.send(JSON.stringify({ type: 'registered', agent_id: agent_id }));
      console.log(`[relay] registered agent_id=${agent_id} total=${connections.size} current_agents=[${connectionIds().join(', ')}]`);
      return;
    }

    if (!agentId) {
      console.log(`[relay] reject type=${type} (send register first)`);
      ws.send(JSON.stringify({ type: 'error', message: 'send register first' }));
      return;
    }

    if (type === 'speak') {
      const body = msg as {
        thread_id?: string;
        content?: string;
        ts?: number;
        message_id?: string;
        sender_display_name?: string;
        sender_union_id?: string;
        sender_open_id?: string;
      };
      const { thread_id, content, ts, message_id, sender_display_name, sender_union_id, sender_open_id } = body;
      if (!thread_id || content === undefined) {
        console.log(`[relay] speak ignored agent_id=${agentId} (missing thread_id or content)`);
        return;
      }
      const peerIds = connectionIds().filter((id) => id !== agentId);
      console.log(`[relay] speak agent_id=${agentId} thread_id=${thread_id} peers=[${peerIds.join(', ')}]`);
      const payload: Record<string, unknown> = {
        type:             'broadcast',
        thread_id,
        sender_agent_id:  agentId,
        content:          content ?? '',
        ts:               typeof ts === 'number' ? ts : Date.now(),
        message_id:       message_id ?? undefined,
      };
      if (sender_display_name != null) payload.sender_display_name = sender_display_name;
      if (sender_union_id != null) payload.sender_union_id = sender_union_id;
      if (sender_open_id != null) payload.sender_open_id = sender_open_id;
      const sent = broadcast(agentId, payload);
      console.log(`[relay] speak done agent_id=${agentId} sent_to=${sent} peers`);
    } else {
      console.log(`[relay] unknown type=${type} agent_id=${agentId}`);
    }
  });

  ws.on('close', () => {
    if (agentId) {
      connections.delete(agentId);
      console.log(`[relay] closed agent_id=${agentId} total=${connections.size} remaining=[${connectionIds().join(', ')}]`);
    } else {
      console.log(`[relay] connection closed before register remote=${remote}`);
    }
  });

  ws.on('error', (err) => {
    console.log(`[relay] ws error agent_id=${agentId ?? 'unregistered'} error=${String(err?.message ?? err)}`);
  });
});

wss.on('listening', () => {
  console.log(`[relay] listening on port ${PORT}`);
});
