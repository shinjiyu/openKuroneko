# 需要人类在浏览器中完成登录操作（如微博等需验证码/二步认证的网站）

> category: browser | id: s-ff51cf | 2026-03-06T09:15:23.765Z

场景：需要人类在浏览器中完成登录操作（如微博等需验证码/二步认证的网站）
步骤：
1. 创建 Playwright 脚本，设置 headless: false 显示浏览器窗口
2. 导航到登录页面后，使用 page.pause() 或 waitForSelector 等待登录完成
3. 登录成功后，使用 context.storageState({ path: 'auth.json' }) 保存登录状态
4. shell_exec 调用时注意：如果脚本会长时间等待，应使用后台运行或适当处理，避免同步等待超时
验证：检查 auth.json 文件是否存在且包含有效的 cookies/tokens
