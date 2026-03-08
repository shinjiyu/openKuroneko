# 小米设备 Token 获取方案对比表

**更新时间**: 2026-03-08  
**调研对象**: 小米摄像头（192.168.31.25）及其他小米智能设备

---

## 方案对比总览

| 方案 | 难度 | 成功率 | 所需工具 | 安全性 | 推荐度 |
|------|------|--------|----------|--------|--------|
| **Xiaomi-cloud-tokens-extractor** | ⭐ 简单 | 95% | Docker + 小米账号 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **iPhone 备份提取** | ⭐⭐ 中等 | 90% | iTunes + iBackup Viewer | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **安卓旧版 App (v5.4.54)** | ⭐⭐ 中等 | 80% | 安卓手机 + 旧版 APK | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **安卓模拟器 + Root** | ⭐⭐⭐ 较难 | 85% | 模拟器 + miio2.db | ⭐⭐⭐ | ⭐⭐⭐ |
| **设备重置绑定** | ⭐ 简单 | 100% | python-miio | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| **Home Assistant 集成** | ⭐⭐ 中等 | 90% | HA + 小米账号 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **安卓 Root + 数据库** | ⭐⭐⭐⭐ 困难 | 70% | Root 手机 + SQLite | ⭐⭐⭐ | ⭐⭐ |

---

## 方案 1: Xiaomi-cloud-tokens-extractor（最推荐）

### ✅ 优点
- **最简单**: 一行 Docker 命令即可
- **最全面**: 一次性获取所有设备 token
- **最稳定**: 持续更新，支持最新小米账号体系
- **跨平台**: Windows/macOS/Linux 都可用

### ⚠️ 缺点
- 需要小米账号密码
- 可能遇到 2FA 双重验证
- 某些账号可能被风控

### 📋 操作步骤
```bash
# 1. 运行 Docker 容器
docker run --rm -it pymoroni/xiaomi-cloud-tokens-extractor

# 2. 按提示输入：
#    - 小米账号（手机号/邮箱）
#    - 密码
#    - 服务器地区（cn）
#    - 可能需要短信验证码

# 3. 查看输出，找到摄像头 token
```

### 🎯 成功率: 95%  
### ⏱️ 耗时: 5-10 分钟

---

## 方案 2: iPhone 备份提取（iOS 用户推荐）

### ✅ 优点
- **无需越狱**: 普通 iPhone 即可
- **安全性高**: 数据在本地处理
- **成功率高**: 只要能备份就能提取

### ⚠️ 缺点
- **仅限 iOS**: 需要苹果设备
- **需要电脑**: 必须通过 iTunes/iMazing 备份
- **步骤较多**: 需要 4-5 个步骤

### 📋 操作步骤
1. **iPhone 完整备份**（不要加密！）
   ```bash
   # 使用 iTunes 或 Finder 备份
   # 或使用 iMazing 等工具
   ```

2. **使用 iBackup Viewer**
   - 下载: https://www.imactools.com/ibackupviewer/
   - 打开备份文件

3. **定位数据库文件**
   ```
   路径: xiaomi.mihome → Documents → XXXXXXXXXXXXX_mihome.sqlite
   ```

4. **导出并用 SQLite 工具打开**
   ```bash
   # 使用 DB Browser for SQLite
   # 执行 SQL:
   SELECT ZTOKEN, ZNAME, ZLOCALIP FROM ZDEVICE;
   ```

5. **解密 token**（如果是 96 位）
   - 访问: https://www.toolhelper.cn/SymmetricEncryption/AES
   - Input type: Text
   - Function: AES
   - Mode: ECB
   - Key: `00000000000000000000000000000000` (32个0)
   - 点击 Decrypt

### 🎯 成功率: 90%  
### ⏱️ 耗时: 15-30 分钟

---

## 方案 3: 安卓旧版 App (v5.4.54)（无 Root 安卓用户）

### ✅ 优点
- **无需 Root**: 普通安卓手机即可
- **操作简单**: 只需安装旧版 App
- **快速**: 几分钟即可完成

### ⚠️ 缺点
- **有风险**: 旧版 App 可能不稳定
- **不一定成功**: 小米可能已封堵
- **日志查找**: 需要在日志文件中搜索

### 📋 操作步骤
1. **卸载当前米家 App**

2. **下载旧版 v5.4.54**
   - APKMirror: https://www.apkmirror.com/
   - 搜索 "Mi Home 5.4.54"

3. **安装并登录**

4. **操作所有设备**（让 App 记录日志）

5. **查找日志文件**
   ```
   路径: /sdcard/SmartHome/logs/Plug_Devicemanager/
   文件: yyyy-mm-dd.txt
   ```

6. **搜索 token**
   ```bash
   # 在日志中搜索:
   grep "token" yyyy-mm-dd.txt
   # 或搜索设备名称
   ```

### 🎯 成功率: 80%  
### ⏱️ 耗时: 10-20 分钟

---

## 方案 4: 安卓模拟器 + Root（Windows/macOS 用户）

### ✅ 优点
- **无需真机**: 电脑上完成
- **可控性强**: 完全控制环境
- **可重复**: 失败可以重来

### ⚠️ 缺点
- **步骤繁琐**: 需要安装模拟器、Root、提取数据库
- **可能有兼容问题**: 某些模拟器不支持旧版 App
- **数据库解析**: 需要使用第三方工具

### 📋 操作步骤
1. **下载夜神模拟器**（内置 Root）
   - 官网: https://www.yeshen.com/

2. **安装米家 App 旧版**
   - 版本要求: 能看到 miio2.db 的版本

3. **提取数据库**
   ```
   路径: /data/data/com.xiaomi.smarthome/databases/miio2.db
   ```

4. **上传到 GetMiio 网站**
   - 网站: http://miio2.token.getive.cn/
   - 上传 miio2.db 文件

5. **查看 token 列表**

### 🎯 成功率: 85%  
### ⏱️ 耗时: 30-60 分钟

---

## 方案 5: 设备重置绑定（100% 成功但麻烦）

### ✅ 优点
- **100% 成功**: 官方方法
- **无需账号**: 不需要小米账号密码
- **最安全**: 完全本地操作

### ⚠️ 缺点
- **需要重置**: 设备会清除所有配置
- **需要重新配网**: 需要重新设置 WiFi
- **仅限一个设备**: 每次只能获取一个设备 token

### 📋 操作步骤
1. **重置摄像头**（按住重置按钮 5-10 秒）

2. **连接摄像头 WiFi**
   ```
   SSID: 类似 "xiaoxun-camera-xxxx"
   密码: 通常为空或简单密码
   ```

3. **使用 python-miio 发现**
   ```bash
   # 安装
   pip install python-miio
   
   # 发现设备
   mirobo discover --handshake 1
   
   # 或使用
   miiocli discover
   ```

4. **查看输出中的 token**
   ```
   IP 192.168.4.1 (ID: 0733a28e) - token: b'f8202c54d81691015eafb661c26ecc00'
   ```

5. **重新配网**（使用米家 App）

### 🎯 成功率: 100%  
### ⏱️ 耗时: 10-15 分钟（但需要重新配置设备）

---

## 方案 6: Home Assistant 集成（智能家居用户）

### ✅ 优点
- **集成方便**: 直接在 HA 中使用
- **功能完整**: 可控制所有设备
- **持续更新**: 社区活跃

### ⚠️ 缺点
- **需要 HA**: 必须安装 Home Assistant
- **需要账号**: 需要小米账号
- **可能需要配置**: 部分功能需要手动配置

### 📋 操作步骤
1. **安装 hass-xiaomi-miot**
   ```
   HACS → 集成 → 搜索 "Xiaomi Miot Auto" → 安装
   ```

2. **添加集成**
   ```
   配置 → 设备与服务 → 添加集成 → Xiaomi Miot Auto
   ```

3. **登录小米账号**
   - 输入账号密码
   - 选择服务器地区

4. **查看设备信息**
   - 在集成页面可以看到所有设备
   - 点击设备可以看到 token 等信息

### 🎯 成功率: 90%  
### ⏱️ 耗时: 15-30 分钟（包括 HA 安装）

---

## 方案 7: 安卓 Root + 数据库（技术玩家）

### ✅ 优点
- **最直接**: 直接读取源数据
- **成功率高**: 只要 Root 成功就能获取

### ⚠️ 缺点
- **需要 Root**: 风险高，可能失去保修
- **难度最高**: 需要技术能力
- **可能失效**: 新版 App 可能加密数据库

### 📋 操作步骤
1. **Root 安卓手机**

2. **安装 Root 文件管理器**
   - 推荐使用 Root Explorer

3. **定位数据库**
   ```
   /data/data/com.xiaomi.smarthome/databases/miio2.db
   ```

4. **复制到电脑**

5. **使用 SQLite 工具打开**
   ```sql
   SELECT * FROM devicerecord;
   ```

### 🎯 成功率: 70%（新版 App 可能已封堵）  
### ⏱️ 耗时: 1-3 小时（包括 Root）

---

## 推荐选择指南

### 🌟 普通用户（无技术背景）
**推荐**: 方案 1 (Xiaomi-cloud-tokens-extractor)
- 只需要 Docker
- 步骤最简单
- 成功率最高

### 🌟 iOS 用户
**推荐**: 方案 2 (iPhone 备份提取)
- 无需额外设备
- 安全性高
- 成功率高

### 🌟 安卓用户（无 Root）
**推荐**: 方案 3 (旧版 App) 或 方案 1 (Docker)
- 不需要 Root
- 操作简单

### 🌟 智能家居玩家
**推荐**: 方案 6 (Home Assistant 集成)
- 一次配置，长期使用
- 可以直接控制设备

### 🌟 技术玩家
**推荐**: 方案 1 (Docker) 或 方案 4 (模拟器)
- 灵活性高
- 可重复尝试

---

## 常见问题

### Q1: Token 会变化吗？
**A**: 通常不会，但以下情况会变化：
- 设备重置
- 更换 WiFi
- 固件更新（少数情况）

### Q2: 获取 Token 后如何使用？
**A**: 
```bash
# python-miio
miiocli device --ip 192.168.31.25 --token YOUR_TOKEN info

# Home Assistant
# 在配置文件中填入 token
```

### Q3: Token 安全吗？
**A**: Token 是设备的重要凭证，请妥善保管，不要泄露给他人

### Q4: 为什么有些方法失效了？
**A**: 小米不断加强安全措施，某些旧方法可能被封堵。建议使用持续更新的工具（如 Xiaomi-cloud-tokens-extractor）

### Q5: 忘记小米账号密码怎么办？
**A**: 
1. 通过小米官网找回密码
2. 使用方案 5（设备重置），无需账号

---

## 结论

**最佳方案**: Xiaomi-cloud-tokens-extractor（方案 1）
- 适合 95% 的用户
- 成功率最高，难度最低
- 持续更新，社区活跃

**备选方案**:
- iOS 用户: iPhone 备份提取（方案 2）
- 智能家居用户: Home Assistant 集成（方案 6）
- 无网络环境: 设备重置（方案 5）

---

**文档创建**: 2026-03-08  
**基于调研**: Token获取方案深度调研报告.md  
**相关文档**: 获取Token操作指南.md
