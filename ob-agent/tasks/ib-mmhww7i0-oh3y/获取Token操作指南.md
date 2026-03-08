# 小米摄像头 Token 获取操作指南

**目标设备**: 192.168.31.25 (小米摄像头)  
**目的**: 获取设备 token 以便通过 miIO 协议控制摄像头  
**更新时间**: 2026-03-08  

---

## 🎯 推荐方案

根据深度调研，**Xiaomi Cloud Tokens Extractor** 是最推荐的方案：
- ✅ 成功率 95%
- ✅ 操作难度 ⭐ (1/5)
- ✅ 无需 ROOT 或越狱
- ✅ 5-10 分钟完成

---

## 前提条件

✅ 已确认设备在线（192.168.31.25）  
✅ 已确认 miIO 端口开放（UDP 54321）  
✅ 已确认设备响应 miIO 发现包  
✅ 已安装 Docker（用于运行 token 提取工具）  
✅ 有小米账号和密码  

---

## 方法 1: Xiaomi Cloud Tokens Extractor（强烈推荐 ⭐⭐⭐⭐⭐）

### 步骤 1: 运行 Docker 容器

```bash
docker run --rm -it pymoroni/xiaomi-cloud-tokens-extractor
```

**备选方案**（如果 Docker 不可用）：
```bash
# Python 脚本本地运行
git clone https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor.git
cd Xiaomi-cloud-tokens-extractor
pip3 install pycryptodome pybase64 requests
python3 token_extractor.py

# 或使用一键脚本
bash <(curl -L https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor/raw/master/run.sh)
```

### 步骤 2: 输入小米账号信息

程序会提示输入：
- 小米账号（手机号或邮箱）
- 密码
- 服务器地区（选择 `cn` 中国区）
- 可能需要短信验证码

**认证方式**：
1. **用户名/密码**：直接输入账号密码
2. **QR 码扫描**：使用米家 App 扫码登录（更安全）

### 步骤 3: 获取 Token

程序会列出所有设备及其 token，找到 IP 为 `192.168.31.25` 的设备：

```
Devices list loaded from the cloud:
Name: 小米摄像头
Model: isa.camera.hlmax
IP: 192.168.31.25
Token: f8202c54d81691015eafb661c26ecc00
Mac: 54:48:e6:2f:1d:3c
```

### 步骤 4: 保存 Token

将 token 保存到环境变量或文件中：

```bash
# 保存到环境变量
export XIAOMI_CAMERA_TOKEN="your-token-here"
export XIAOMI_CAMERA_IP="192.168.31.25"

# 或保存到文件
echo "your-token-here" > ~/.xiaomi_camera_token

# 或添加到 shell 配置文件（永久保存）
echo 'export XIAOMI_CAMERA_TOKEN="your-token-here"' >> ~/.zshrc
echo 'export XIAOMI_CAMERA_IP="192.168.31.25"' >> ~/.zshrc
source ~/.zshrc
```

### ⚠️ 可能遇到的问题

**问题 1: 2FA 双重验证**
- **现象**：提示需要双重验证
- **解决**：使用 QR 码扫描方式登录，或通过浏览器抓包获取参数

**问题 2: 账号被风控**
- **现象**：登录失败或提示账号异常
- **解决**：更换网络环境，或尝试其他方法（如方法 2）

**问题 3: Docker 不可用**
- **解决**：使用 Python 脚本方式，或安装 Docker Desktop

---

## 方法 2: 使用修改版米家 App

### 步骤 1: 下载修改版 App

项目地址: https://github.com/Maxmudjon/Get_MiHome_devices_token

### 步骤 2: 安装并登录

1. 卸载原版米家 App
2. 安装修改版 APK
3. 登录小米账号

### 步骤 3: 查看 Token

在设备详情页可以看到设备的 token

---

## 方法 3: 使用 Home Assistant

### 步骤 1: 安装 hass-xiaomi-miot

```bash
# 在 Home Assistant 中
# 配置 → 集成 → 添加集成 → 搜索 "Xiaomi Miot Auto"
```

### 步骤 2: 登录小米账号

输入小米账号和密码，选择服务器地区

### 步骤 3: 获取 Token

在集成配置页面可以看到所有设备的 token

---

## 方法 4: 使用 python-miio 云端 API

### 步骤 1: 安装依赖

```bash
pip install micloud
```

### 步骤 2: 创建登录脚本

```python
from micloud import MiCloud

mc = MiCloud()
mc.login('your_username', 'your_password')
devices = mc.get_devices()
for device in devices:
    if device['localip'] == '192.168.31.25':
        print(f"Token: {device['token']}")
        print(f"Model: {device['model']}")
```

---

## 获取 Token 后的测试命令

### 测试设备连接

```bash
# 使用 miiocli 测试连接
miiocli device --ip 192.168.31.25 --token YOUR_TOKEN info

# 查询设备型号
miiocli genericmiot --ip 192.168.31.25 --token YOUR_TOKEN info
```

### 测试 PTZ 控制

```bash
# 列出所有属性
miiocli genericmiot --ip 192.168.31.25 --token YOUR_TOKEN properties

# 列出所有操作
miiocli genericmiot --ip 192.168.31.25 --token YOUR_TOKEN actions

# 查找 PTZ 相关功能
miiocli genericmiot --ip 192.168.31.25 --token YOUR_TOKEN properties | grep -i ptz
miiocli genericmiot --ip 192.168.31.25 --token YOUR_TOKEN actions | grep -i ptz
```

### 测试视频流

```bash
# 如果 RTSP 功能开启
ffplay rtsp://192.168.31.25:554/live/ch00_0

# 或使用 VLC
vlc rtsp://192.168.31.25:554/live/ch00_0
```

---

## 注意事项

1. **Token 保密**: Token 是设备的重要凭证，不要泄露给他人
2. **Token 变化**: 某些情况下 token 可能会变化（如重置设备、更换 WiFi 等）
3. **账号安全**: 使用第三方工具时注意账号安全
4. **法律合规**: 确保操作符合相关法律法规

---

## 预期结果

获取 token 后，应该能够：

✅ 查询设备完整信息（型号、固件版本、序列号等）  
✅ 控制云台转动（上下左右、预设位、巡航）  
✅ 开启/关闭 RTSP 功能  
✅ 获取视频流地址  
✅ 控制其他功能（夜视、报警、移动侦测等）  

---

**文档创建时间**: 2026-03-08 23:58  
**相关文档**: 连接测试报告.md, 技术调研报告-小米摄像头API.md
