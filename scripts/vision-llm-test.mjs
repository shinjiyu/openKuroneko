/**
 * 第一层：仅测 LLM API 是否支持带图请求。
 * 用法：
 *   node scripts/vision-llm-test.mjs          # 纯文本，验证接口通
 *   node scripts/vision-llm-test.mjs with-image  # 带图，验证是否支持多模态
 * 读 .env 的 OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL。
 *
 * 实测（open.bigmodel.cn api/coding/paas/v4 + glm-5）：
 *   纯文本 → 200 OK；带 image_url → 400 code 1210（当前接口/模型不支持多模态）。
 * 若需真正看图，可换用智谱视觉模型（如 glm-4v）及对应 base URL。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

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

const BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

if (!KEY) {
  console.error('Missing OPENAI_API_KEY (set in .env or env)');
  process.exit(1);
}

// 1x1 透明 PNG，仅用于验证 API 是否接受 image_url
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const dataUrl = `data:image/png;base64,${TINY_PNG_B64}`;

// 可通过参数选择：只测纯文本(默认) 或 带图。例: node scripts/vision-llm-test.mjs with-image
// 若带 with-image 且当前 BASE 为 coding 端点，可设 USE_VISION_ENDPOINT=1 用 paas/v4+glm-4v-flash 测
const withImage = process.argv.includes('with-image');
const useVisionEndpoint = process.env.USE_VISION_ENDPOINT === '1' && withImage;

const visionBase = 'https://open.bigmodel.cn/api/paas/v4';
const visionModel = process.env.GLM_VISION_MODEL || 'glm-4v-flash';
const baseForRequest = useVisionEndpoint ? visionBase : BASE.replace(/\/$/, '');
const modelForRequest = useVisionEndpoint ? visionModel : MODEL;
const url = baseForRequest + '/chat/completions';

const userContent = withImage
  ? [
      { type: 'text', text: '这张图里有什么？回复一句话。' },
      { type: 'image_url', image_url: { url: dataUrl } },
    ]
  : '你好，用一句话介绍你自己。';

const body = {
  model: modelForRequest,
  messages: [
    { role: 'system', content: '你是一个助手。用一句话回答。' },
    { role: 'user', content: userContent },
  ],
};

console.log('--- 请求 ---');
console.log('URL:', url);
console.log('model:', body.model);
console.log('user content:', withImage ? '[ text, image_url ] (1x1 PNG data URL)' : '(纯文本)');
if (useVisionEndpoint) console.log('(USE_VISION_ENDPOINT=1 → paas/v4 +', visionModel + ')');
console.log('');

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${KEY}`,
  },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log('--- 响应 ---');
console.log('status:', res.status, res.statusText);
try {
  const json = JSON.parse(text);
  if (res.ok) {
    const content = json.choices?.[0]?.message?.content ?? '';
    console.log('content:', content);
    console.log('(LLM 带图请求成功)');
  } else {
  console.log('body:', JSON.stringify(json, null, 2));
  }
} catch {
  console.log('body (raw):', text.slice(0, 500));
}
process.exit(res.ok ? 0 : 1);
