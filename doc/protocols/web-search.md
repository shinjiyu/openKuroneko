# web_search 工具协议

**版本**：v1.0  
**日期**：2026-03-05

---

## 1. 概述

`web_search` 工具提供网页搜索与页面抓取能力，不依赖第三方搜索 API，采用以下两种引擎之一：

| 引擎 | 实现方式 | 适用场景 |
|------|---------|---------|
| `curl` | `execSync curl` + DuckDuckGo HTML 接口解析 | 默认；轻量、无需安装浏览器 |
| `playwright` | Playwright Chromium 无头浏览器 | 需要 JS 渲染或更完整页面内容 |

引擎通过环境变量 `OPENKURONEKO_SEARCH_ENGINE=curl|playwright` 选择，默认为 `curl`。

---

## 2. 工具参数

```ts
interface WebSearchArgs {
  action: 'search' | 'fetch';  // 默认 'search'
  query?: string;               // action=search 时必填：搜索关键词
  url?: string;                 // action=fetch 时必填：目标页面 URL
  max_results?: number;         // action=search 时返回条数，默认 5，最大 10
  engine?: 'curl' | 'playwright'; // 覆盖环境变量，默认继承全局配置
}
```

---

## 3. 动作语义

### 3.1 `search` — 搜索

- 以 `query` 在 DuckDuckGo（HTML 接口）或通过 Playwright 搜索
- 返回若干条结果，每条格式：
  ```
  [N] <标题>
      URL: <url>
      <摘要>
  ```
- 若无结果，返回 `"No results found."`

### 3.2 `fetch` — 抓取页面

- 以 `url` 获取页面的纯文本内容（strip HTML tags）
- curl 引擎：`curl -s -L --max-time 20 <url>`
- playwright 引擎：无头 Chromium navigate + `page.innerText('body')`
- 内容超过 8000 字符时截断并附 `[...truncated]`

---

## 4. curl 引擎约定

- 搜索 URL：`https://html.duckduckgo.com/html/`（POST，参数 `q=<encoded>`）
- User-Agent：`Mozilla/5.0 (compatible; openKuroneko/1.0)`
- 超时：`--max-time 15`（搜索），`--max-time 20`（fetch）
- HTML 解析：正则提取 `.result__a` / `.result__url` / `.result__snippet`

---

## 5. playwright 引擎约定

- 浏览器：Chromium（`playwright install chromium`）
- 无头模式：`headless: true`
- 搜索 URL：`https://html.duckduckgo.com/html/?q=<encoded>` (同 curl，避免 JS 搜索引擎反爬)
- 每次调用启动 browser → page → 操作 → 关闭（无全局常驻）
- 超时：`page.goto` timeout 20000ms

---

## 6. 错误行为

| 场景 | 处理 |
|------|------|
| 网络不可达 | 返回 `{ ok: false, output: "Network error: ..." }` |
| curl 不可用 | 返回 `{ ok: false, output: "curl not found" }` |
| playwright 未安装 | 返回 `{ ok: false, output: "playwright not installed. Run: npx playwright install chromium" }` |
| query/url 为空 | 返回 `{ ok: false, output: "Missing required argument" }` |
| 解析结果为空 | 返回 `{ ok: true, output: "No results found." }` |
