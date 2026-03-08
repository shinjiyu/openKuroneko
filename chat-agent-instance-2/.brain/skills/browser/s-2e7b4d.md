# 需要人类在浏览器中手动完成登录（如微博等需要验证码/二步验证的网站）

> category: browser | id: s-2e7b4d | 2026-03-06T09:15:23.765Z

场景：需要人类在浏览器中手动完成登录（如微博等需要验证码/二步验证的网站）

步骤：
1. 创建 Playwright 脚本，设置 `headless: false` 显示浏览器窗口
2. 导航到登录页面（如 `https://weibo.com`）
3. 使用轮询方式检测登录成功标志（如 `[class*="user"]` 或 `[class*="home"]` 元素）
4. 检测到登录成功后，调用 `context.storageState({ path: 'auth.json' })` 保存 cookies/localStorage
5. 使用 `await browser.close()` 关闭浏览器，然后 `process.exit(0)` 退出脚本

验证：
- 检查 auth.json 文件是否生成且包含 cookies
- 脚本进程是否正常退出（无僵尸进程）
- 使用保存的状态重新打开浏览器时能直接访问需登录的页面
