/**
 * 最小 demo：直接调用 Kimi tool call 两轮，复现 tool_call_id is not found。
 * 用法：在项目根目录执行 node scripts/kimi-tool-demo.mjs（会读 .env）
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// 简单加载 .env
try {
  const envPath = join(root, '.env');
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const t = line.trim();
    if (t && !t.startsWith('#')) {
      const i = t.indexOf('=');
      if (i > 0) {
        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
          v = v.slice(1, -1);
        process.env[k] = v;
      }
    }
  }
} catch (e) {
  console.warn('No .env:', e.message);
}

const BASE = process.env.OPENAI_BASE_URL || 'https://api.moonshot.cn/v1';
const KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.OPENAI_MODEL || 'kimi-k2.5';

if (!KEY) {
  console.error('Missing OPENAI_API_KEY (set in .env or env)');
  process.exit(1);
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_time',
      description: 'Get current time',
      parameters: { type: 'object', properties: {} },
    },
  },
];

async function main() {
  console.log('--- Request 1: user message + tools ---');
  const body1 = {
    model: MODEL,
    thinking: { type: 'disabled' },
    messages: [
      { role: 'system', content: 'You are a helpful assistant. Use tools when needed.' },
      { role: 'user', content: '现在几点了？请用工具查一下。' },
    ],
    tools,
    tool_choice: 'auto',
  };

  const res1 = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(body1),
  });

  const data1 = await res1.json();
  if (data1.error) {
    console.error('Request 1 error:', data1.error);
    return;
  }

  const msg1 = data1.choices?.[0]?.message;
  if (!msg1) {
    console.error('No choices:', JSON.stringify(data1, null, 2));
    return;
  }

  const rawToolCalls = msg1.tool_calls || [];
  console.log('Response 1 message.content:', msg1.content);
  console.log('Response 1 message.tool_calls:', JSON.stringify(rawToolCalls, null, 2));

  if (rawToolCalls.length === 0) {
    console.log('No tool_calls in response, skip request 2.');
    return;
  }

  const tc = rawToolCalls[0];
  const idFromApi = tc.id;
  const id = (idFromApi && String(idFromApi).trim()) || `call_${Math.random().toString(36).slice(2)}`;
  console.log('Use tool_call id:', id, idFromApi ? '(from API)' : '(fallback)');

  console.log('\n--- Request 2: assistant(with tool_calls) + tool result ---');
  const assistantMsg = {
    role: 'assistant',
    content: msg1.content || null,
    tool_calls: rawToolCalls.map((t) => ({
      id: (t.id && String(t.id).trim()) || id,
      type: 'function',
      function: { name: t.function?.name || 'get_time', arguments: t.function?.arguments || '{}' },
    })),
  };
  const toolMsg = {
    role: 'tool',
    content: '[get_time] 2026-03-09 18:00:00',
    tool_call_id: id,
  };

  const body2 = {
    model: MODEL,
    thinking: { type: 'disabled' },
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: '现在几点了？请用工具查一下。' },
      assistantMsg,
      toolMsg,
    ],
    tools,
    tool_choice: 'auto',
  };

  console.log('Request 2 messages (last 2):', JSON.stringify([assistantMsg, toolMsg], null, 2));

  const res2 = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(body2),
  });

  const text2 = await res2.text();
  let data2;
  try {
    data2 = JSON.parse(text2);
  } catch {
    console.error('Response 2 not JSON:', text2.slice(0, 500));
    return;
  }

  if (data2.error) {
    console.error('Request 2 error:', data2.error);
    console.error('Full response:', text2);
    return;
  }

  const msg2 = data2.choices?.[0]?.message;
  console.log('Response 2 success. message.content:', msg2?.content?.slice(0, 200));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
