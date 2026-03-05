/**
 * curl 引擎 —— 使用系统 curl 访问 DuckDuckGo HTML 接口
 */

import { execSync } from 'node:child_process';
import { formatResults, parseDDGResults, truncatePage } from './html-parser.js';

const DDG_HTML_URL = 'https://html.duckduckgo.com/html/';
const UA = 'Mozilla/5.0 (compatible; openKuroneko/1.0)';

function curl(args: string, timeoutMs = 20_000): string {
  const cmd = `curl -s -L --max-time ${Math.ceil(timeoutMs / 1000)} -A "${UA}" ${args}`;
  return execSync(cmd, { encoding: 'utf8', timeout: timeoutMs + 2_000 });
}

export function curlSearch(query: string, maxResults: number): string {
  const encoded = encodeURIComponent(query);
  // POST to DDG HTML endpoint
  const html = curl(
    `-X POST "${DDG_HTML_URL}" -d "q=${encoded}&b=&kl=wt-wt"`,
    15_000
  );
  const results = parseDDGResults(html, maxResults);
  return formatResults(results);
}

export function curlFetch(url: string): string {
  const html = curl(`"${url}"`, 20_000);
  return truncatePage(
    html.replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
  );
}
