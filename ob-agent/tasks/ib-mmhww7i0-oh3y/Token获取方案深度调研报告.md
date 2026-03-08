# 小米摄像头 Token 获取方案深度调研报告

**调研目标**: 系统性研究所有可行的小米设备 token 获取途径  
**调研时间**: 2026-03-08  
**目标设备**: 192.168.31.25 (小米摄像头, Imilab 厂商)

---

## 📋 执行摘要

通过深度调研，发现 **5 种主要 token 获取方案**，其中 **Xiaomi Cloud Tokens Extractor (Docker)** 方案最为推荐，因为：
- ✅ 无需 ROOT 权限
- ✅ 无需安卓设备
- ✅ 跨平台支持（macOS/Windows/Linux）
- ✅ 操作简单，成功率高
- ⚠️ 需要小米账号和密码

---

## 🔍 Token 获取方案详细对比

### 方案 1: Xiaomi Cloud Tokens Extractor（推荐 ⭐⭐⭐⭐⭐）

#### 技术原理
通过小米云端 API 获取所有已绑定设备的 token，使用 Python 脚本调用小米官方云端接口。

#### 操作步骤
```bash
# 方法 1: Docker 运行（最简单）
docker run --rm -it pymoroni/xiaomi-cloud-tokens-extractor

# 方法 2: Python 脚本本地运行
git clone https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor.git
cd Xiaomi-cloud-tokens-extractor
pip3 install pycryptodome pybase64 requests
python3 token_extractor.py

# 方法 3: 一键脚本
bash <(curl -L https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor/raw/master/run.sh)
```

#### 认证方式
1. **用户名/密码方式**
   - 输入小米账号（手机号或邮箱）
   - 输入密码
   - 选择服务器地区（cn - 中国区）
   - 可能需要短信验证码

2. **QR 码扫描方式**
   - 生成二维码
   - 使用米家 App 扫码登录

#### 输出结果
```
Devices list loaded from the cloud:
Name: 小米摄像头
Model: isa.camera.hlmax
IP: 192.168.31.25
Token: f8202c54d81691015eafb661c26ecc00
Mac: 54:48:e6:2f:1d:3c
```

#### 优点
- ✅ 无需 ROOT 权限
- ✅ 无需安卓设备
- ✅ 跨平台支持
- ✅ 可获取所有设备 token
- ✅ 开源项目，社区活跃（4.3k stars）
- ✅ 支持两种认证方式

#### 缺点
- ⚠️ 需要小米账号和密码
- ⚠️ 可能遇到 2FA 双重验证
- ⚠️ 小米可能加强安全机制导致工具失效

#### 可行性评分
- **技术难度**: ⭐ (1/5) - 非常简单
- **成功率**: ⭐⭐⭐⭐ (4/5) - 较高
- **推荐度**: ⭐⭐⭐⭐⭐ (5/5) - 强烈推荐

---

### 方案 2: 设备重置绑定法

#### 技术原理
重置设备后，设备会进入配网模式，此时通过 miIO discovery 可以直接获取 token（部分固件版本）。

#### 操作步骤
```bash
# 1. 重置摄像头（长按重置按钮 5 秒）
# 2. 连接摄像头发出的 WiFi 热点
# 3. 运行发现命令
pip3 install python-miio
mirobo discover --handshake 1

# 或使用 miiocli
miiocli discover
```

#### 输出示例
```
INFO:miio.miioprotocol: IP 192.168.4.1 (ID: 0733a28e) - token: b'f8202c54d81691015eafb661c26ecc00'
```

#### 优点
- ✅ 无需账号密码
- ✅ 无需 ROOT
- ✅ 官方协议支持

#### 缺点
- ⚠️ 需要重置设备（清除所有配置）
- ⚠️ 固件版本 3.3.9_003077 以上已封堵
- ⚠️ 部分设备不支持
- ⚠️ 需要重新配网

#### 可行性评分
- **技术难度**: ⭐⭐ (2/5) - 简单
- **成功率**: ⭐⭐ (2/5) - 较低（固件限制）
- **推荐度**: ⭐⭐⭐ (3/5) - 作为备选方案

---

### 方案 3: 安卓手机 + 旧版米家 App

#### 技术原理
旧版米家 App (v5.4.54) 存在漏洞，会在日志文件中暴露设备 token。

#### 操作步骤
```bash
# 1. 卸载当前米家 App
# 2. 下载旧版米家 App v5.4.54
#    下载地址: https://www.apkmirror.com/
# 3. 安装并登录账号
# 4. 操作所有设备（触发日志记录）
# 5. 使用文件管理器查看日志
路径: /sdcard/SmartHome/logs/Plug_Devicemanager/
文件: yyyy-mm-dd.txt
# 6. 搜索 "token" 或设备名称
```

#### 优点
- ✅ 无需 ROOT
- ✅ 无需电脑
- ✅ 可获取所有设备 token

#### 缺点
- ⚠️ 需要安卓手机
- ⚠️ 需要找到旧版 APK
- ⚠️ 新版 Android 可能不兼容旧版 App
- ⚠️ 小米可能已封堵漏洞
- ⚠️ 安全风险（旧版 App 可能有漏洞）

#### 可行性评分
- **技术难度**: ⭐⭐ (2/5) - 简单
- **成功率**: ⭐⭐⭐ (3/5) - 中等
- **推荐度**: ⭐⭐⭐ (3/5) - 有安卓手机可尝试

---

### 方案 4: iPhone 备份提取法（iOS 用户）

#### 技术原理
iPhone 未加密备份中包含米家 App 的 SQLite 数据库，可以直接读取 token。

#### 操作步骤
```bash
# 1. iPhone 完整备份到电脑（不要勾选加密备份）
# 2. 下载 iBackup Viewer 工具
# 3. 定位文件
路径: xiaomi.mihome/Documents/XXXXXXXXXXXXX_mihome.sqlite

# 4. 导出 SQLite 文件
# 5. 使用 DB Browser for SQLite 打开
# 6. 执行 SQL 查询
SELECT ZTOKEN, ZNAME, ZLOCALIP FROM ZDEVICE

# 7. 如果 token 是 96 位 HEX，需要解密
# 使用在线工具: https://www.browserling.com/tools/aes-decrypt
# 配置:
#   Input type: Text
#   Function: AES
#   Mode: ECB
#   Key: 00000000000000000000000000000000 (32个0)
#   选择 Hex
```

#### 优点
- ✅ 无需越狱
- ✅ 可获取所有设备 token
- ✅ 官方数据，准确可靠

#### 缺点
- ⚠️ 需要 iPhone
- ⚠️ 需要电脑
- ⚠️ 备份文件较大
- ⚠️ 新版米家可能加密 token
- ⚠️ 需要 iOS 备份提取工具

#### 可行性评分
- **技术难度**: ⭐⭐⭐ (3/5) - 中等
- **成功率**: ⭐⭐⭐⭐ (4/5) - 较高
- **推荐度**: ⭐⭐⭐⭐ (4/5) - iOS 用户推荐

---

### 方案 5: 安卓模拟器 + ROOT

#### 技术原理
在电脑上运行安卓模拟器，开启 ROOT 权限，直接读取米家 App 数据库。

#### 操作步骤
```bash
# 1. 下载安卓模拟器（如夜神模拟器）
# 2. 开启 ROOT 权限
# 3. 安装米家 App（旧版更好）
# 4. 登录账号
# 5. 使用文件管理器导出数据库
路径: /data/data/com.xiaomi.smarthome/databases/miio2.db

# 6. 使用在线工具解析
网址: https://getmiio.herokuapp.com/
上传 miio2.db 文件即可获取 token
```

#### 优点
- ✅ 无需真实安卓设备
- ✅ 可获取所有设备 token
- ✅ 模拟器可重复使用

#### 缺点
- ⚠️ 需要安装模拟器（资源占用大）
- ⚠️ 需要熟悉安卓系统
- ⚠️ 新版米家可能不在本地存储 token
- ⚠️ 操作步骤较多

#### 可行性评分
- **技术难度**: ⭐⭐⭐ (3/5) - 中等
- **成功率**: ⭐⭐⭐ (3/5) - 中等
- **推荐度**: ⭐⭐⭐ (3/5) - 作为备选方案

---

## 📊 方案对比总结表

| 方案 | 难度 | 成功率 | 推荐度 | 需要设备 | 需要 ROOT |
|------|------|--------|--------|----------|-----------|
| **Xiaomi Cloud Tokens Extractor** | ⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 电脑 | ❌ |
| **设备重置绑定** | ⭐⭐ | ⭐⭐ | ⭐⭐⭐ | 电脑 | ❌ |
| **安卓 + 旧版米家** | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | 安卓手机 | ❌ |
| **iPhone 备份提取** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | iPhone + 电脑 | ❌ |
| **安卓模拟器 + ROOT** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | 电脑 | ✅ |

---

## 🎯 针对当前环境的推荐方案

根据您的环境（macOS，已知设备 IP 192.168.31.25），**强烈推荐使用方案 1: Xiaomi Cloud Tokens Extractor**。

### 推荐理由
1. ✅ **您使用 macOS**，Docker 运行完美支持
2. ✅ **无需额外设备**（不需要安卓或 iPhone）
3. ✅ **操作最简单**，只需一条 Docker 命令
4. ✅ **成功率最高**，社区验证 4.3k+ stars
5. ✅ **无需 ROOT**，无需重置设备

### 实施步骤（针对您的情况）

```bash
# 步骤 1: 运行 token 提取工具
docker run --rm -it pymoroni/xiaomi-cloud-tokens-extractor

# 步骤 2: 按提示输入
# - 小米账号（手机号或邮箱）
# - 密码
# - 服务器地区：cn

# 步骤 3: 在输出中找到您的摄像头
# Device: 小米摄像头
# IP: 192.168.31.25
# Token: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 步骤 4: 保存 token
export XIAOMI_CAMERA_TOKEN="your-token-here"
export XIAOMI_CAMERA_IP="192.168.31.25"

# 步骤 5: 验证 token
miiocli device --ip 192.168.31.25 --token $XIAOMI_CAMERA_TOKEN info
```

---

## ⚠️ 注意事项与风险提示

### 安全风险
1. **账号安全**: 使用第三方工具需要输入小米账号密码，确保从官方 GitHub 下载
2. **Token 保密**: Token 是设备的重要凭证，不要泄露给他人
3. **数据备份**: 建议在使用前备份重要配置

### 技术限制
1. **2FA 问题**: 小米可能启用双重验证，需要额外处理
2. **固件更新**: 新固件可能封堵某些获取方法
3. **Token 变化**: 设备重置或更换 WiFi 后 token 可能变化

### 法律合规
1. **仅用于个人设备**: 不要尝试获取他人设备的 token
2. **遵守用户协议**: 某些操作可能违反小米用户协议
3. **安全研究**: 本文档仅供技术研究和学习使用

---

## 🔄 备选方案（如果方案 1 失败）

### 优先级排序
1. **方案 3**: 安卓手机 + 旧版米家（如果有安卓设备）
2. **方案 2**: 设备重置绑定（如果固件支持）
3. **方案 5**: 安卓模拟器（作为最后手段）

---

## 📚 参考资源

### 官方项目
- Xiaomi Cloud Tokens Extractor: https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor
- python-miio: https://github.com/rytilahti/python-miio

### 教程文章
- 2024 取得小米設備的Token教學: https://www.techmarks.com/get-mijia-token/
- 获取米家设备 token: https://swsmile.info/post/iot-extract-mi-device-token/
- 只要一台电脑，轻松获取米家设备 token: https://zhuanlan.zhihu.com/p/267520042

### 社区讨论
- Home Assistant 社区: https://community.home-assistant.io/t/xiaomi-token-extractor-docker/296354
- 瀚思彼岸论坛: https://bbs.hassbian.com/thread-5500-1-1.html

---

## ✅ 下一步行动计划

### 立即执行
1. ✅ 运行 Xiaomi Cloud Tokens Extractor 获取 token
2. ✅ 保存 token 到环境变量
3. ✅ 使用 miiocli 验证 token 有效性

### 后续测试
1. 🔍 列出设备所有属性和方法
2. 🔍 查找 PTZ 控制相关接口
3. 🔍 测试云台控制功能
4. 🔍 测试视频流获取

### 文档输出
1. 📝 Token 获取操作记录
2. 📝 设备功能清单
3. 📝 PTZ 控制测试报告

---

**报告完成时间**: 2026-03-08 16:20  
**调研结论**: 推荐使用 **Xiaomi Cloud Tokens Extractor** 方案，操作简单，成功率高  
**预计完成时间**: 5-10 分钟（如果网络顺畅）