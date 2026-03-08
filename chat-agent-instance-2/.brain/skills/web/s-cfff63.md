# 使用 Playwright 访问需登录的微博页面

> category: web | id: s-cfff63 | 2026-03-06T09:59:30.647Z

场景：需要访问微博等需要登录才能查看的用户主页或搜索结果页面，且已有保存的登录状态文件（如 weibo-auth.json）

步骤：
1. 使用 Playwright 创建浏览器上下文时，加载已保存的登录状态
   ```javascript
   const context = await browser.newContext({
     storageState: 'weibo-auth.json'
   });
   ```
2. 访问目标页面，设置足够的超时时间（30-60秒）和等待时间（5-10秒）
3. 使用 page.screenshot() 保存截图作为证据
4. 使用 page.evaluate(() => document.body.innerText) 提取页面文本内容
5. 保存为文本文件和 JSON 文件供后续分析

验证：
- 页面 URL 未重定向到登录页
- 截图显示完整的用户信息（而非登录表单）
- 提取的文本包含用户名、粉丝数等关键信息
