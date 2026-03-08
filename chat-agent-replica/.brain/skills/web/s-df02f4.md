# Playwright 加载已保存登录状态访问需认证网站

> category: web | id: s-df02f4 | 2026-03-06T09:59:43.929Z

场景：需要访问微博、Instagram 等需要登录才能查看内容的网站，且已有之前保存的登录状态文件（Playwright storageState JSON）。

步骤：
  1. 确认已存在登录状态文件（如 weibo-auth.json），包含 cookies 和 session 信息
  2. 使用 Playwright 创建浏览器上下文时传入 storageState 参数：
     `const context = await browser.newContext({ storageState: 'weibo-auth.json' });`
  3. 创建页面并导航到目标 URL：`await page.goto('https://weibo.com/u/1924675227')`
  4. 等待页面加载（建议 5-10 秒）：`await page.waitForTimeout(8000)`
  5. 使用 page.evaluate() 提取页面内容：`const text = await page.evaluate(() => document.body.innerText)`
  6. 保存截图和数据到本地文件

验证：
  - 页面 URL 不再重定向到登录页
  - 能获取到用户主页的真实内容（粉丝数、微博内容等）
  - 页面截图显示完整用户信息而非登录表单
