# 小米摄像头 Token 获取实施指南

**目标设备**: 192.168.31.25 (小米摄像头, Imilab 厂商)
**创建时间**: 2026-03-09 00:26
**状态**: 等待用户操作

---

## 🔴 关键问题

**Token 获取需要您的配合**，因为涉及到账号安全信息。

---

## 📋 方案 A：Xiaomi Cloud Tokens Extractor（推荐，需要小米账号）

### ✅ 前置条件
- [x] Docker 已安装 ✓
- [x] 工具已下载 ✓ (位于 `Xiaomi-cloud-tokens-extractor/` 目录)
- [ ] **需要您提供**: 小米账号（手机号或邮箱）和密码

### 🚀 操作步骤

**方法 1: Docker 一键运行（最简单）**

在终端中执行：
```bash
docker run --rm -it pymoroni/xiaomi-cloud-tokens-extractor
```

然后按提示输入：
1. 小米账号（手机号或邮箱）
2. 密码
3. 服务器地区（输入 `cn` 选择中国区）
4. 如果需要短信验证码，输入收到的验证码

**方法 2: Python 脚本运行**

```bash
cd /Users/user/Documents/openKuroneko/ob-agent/tasks/ib-mmhww7i0-oh3y/Xiaomi-cloud-tokens-extractor
python3 token_extractor.py
```

### 📤 预期输出

工具会列出所有已绑定到您小米账号的设备：
```
Devices list loaded from the cloud:
Name: 小米摄像头
Model: isa.camera.hlmax
IP: 192.168.31.25
Token: f8202c54d81691015eafb661c26ecc00  ← 这个就是需要的 token
Mac: 54:48:e6:2f:1d:3c
```

### ⏱️ 预计耗时：5-10 分钟

---

## 📋 方案 B：设备重置法（无需小米账号，但有风险）

### ⚠️ 注意事项
- 需要物理接触摄像头
- 会清除摄像头所有设置
- **固件 3.3.9_003077 以上版本已封堵此方法**

### 🚀 操作步骤

1. **重置摄像头**：长按重置按钮 5 秒
2. **等待待绑定状态**：摄像头指示灯会闪烁
3. **立即运行命令**（在重置后 5 分钟内）：
```bash
miiocli discover
```
4. **查找 token**：输出中会包含设备的 token

### ❌ 缺点
- 成功率不确定（取决于固件版本）
- 需要重新配置摄像头

---

## 📋 方案 C：iPhone 备份提取（如果您有 iPhone）

### 📱 适用条件
- 您有 iPhone 且安装了米家 App
- 设备已添加到米家 App

### 🚀 操作步骤

1. **iPhone 未加密备份**（通过 iTunes 或 Finder）
2. **下载 iBackup Viewer**（免费软件）
3. **定位文件**：`xiaomi.mihome/Documents/XXX_mihome.sqlite`
4. **打开数据库**，查找 token 字段

---

## ❓ 常见问题

### Q: 我没有小米账号怎么办？
A: 您需要先注册小米账号，并在米家 App 中添加摄像头设备。或者尝试方案 B（设备重置法）。

### Q: Token 会过期吗？
A: 通常不会，除非您重置设备或更换 WiFi。

### Q: 获取 Token 后做什么？
A: 提供给我后，我可以帮您：
1. 验证 token 有效性
2. 获取设备完整信息
3. 测试 PTZ 控制功能
4. 获取视频流地址

---

## 🎯 下一步行动

**请您选择一个方案并执行**：

1. **如果有小米账号** → 执行方案 A（Docker 命令）
2. **如果没有账号但可以重置设备** → 执行方案 B
3. **如果有 iPhone** → 执行方案 C

**获取 token 后**，请告诉我 token 值，我会继续后续验证工作。

---

**重要提示**：Token 是设备的重要凭证，请妥善保管，不要泄露给他人。
