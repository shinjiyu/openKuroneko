/**
 * playwright 引擎 —— Chromium 无头浏览器
 *
 * 每次调用独立启动 / 关闭，保持无状态。
 * 需要预先安装：npx playwright install chromium
 */

import { formatResults, parseDDGResults, truncatePage } from './html-parser.js';

const DDG_HTML_URL = 'https://html.duckduckgo.com/html/';

async function withBrowser<T>(fn: (page: import('playwright').Page) => Promise<T>): Promise<T> {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    throw new Error(
      'playwright not installed. Run: npx playwright install chromium'
    );
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (compatible; openKuroneko/1.0)',
  });
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await browser.close();
  }
}

export async function playwrightSearch(query: string, maxResults: number): Promise<string> {
  return withBrowser(async (page) => {
    const url = `${DDG_HTML_URL}?q=${encodeURIComponent(query)}&b=&kl=wt-wt`;
    await page.goto(url, { timeout: 20_000, waitUntil: 'domcontentloaded' });
    const html = await page.content();
    const results = parseDDGResults(html, maxResults);
    return formatResults(results);
  });
}

export async function playwrightFetch(url: string): Promise<string> {
  return withBrowser(async (page) => {
    await page.goto(url, { timeout: 20_000, waitUntil: 'domcontentloaded' });
    const text = await page.innerText('body');
    return truncatePage(text.replace(/\s+/g, ' ').trim());
  });
}
