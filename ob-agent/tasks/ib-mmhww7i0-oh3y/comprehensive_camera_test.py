#!/usr/bin/env python3
"""
小米摄像头全面连接测试
尝试多种方法与摄像头建立通信
"""

import socket
import struct
import time
import subprocess
import json

TARGET_IP = "192.168.31.25"
UDP_PORT = 54321

print("=" * 60)
print("小米摄像头全面连接测试")
print("=" * 60)
print(f"目标设备: {TARGET_IP}")
print("=" * 60)

# ============================================================
# 1. 测试 RTSP 流（即使端口关闭也尝试）
# ============================================================
print("\n1. 测试 RTSP 视频流...")
print("注意：小米摄像头的 RTSP 端口默认关闭")
print("     需要在米家 App 中开启 RTSP 功能")

# 常见的 RTSP URL 模式
rtsp_urls = [
    f"rtsp://{TARGET_IP}:554/live/ch00_0",  # 主码流
    f"rtsp://{TARGET_IP}:554/live/ch00_1",  # 子码流
    f"rtsp://{TARGET_IP}:554/live/ch01_0",
    f"rtsp://{TARGET_IP}:554/live/ch01_1",
    f"rtsp://{TARGET_IP}:8554/live",
    f"rtsp://admin:admin@{TARGET_IP}:554/live/ch00_0",
    f"rtsp://root:root@{TARGET_IP}:554/live/ch00_0",
]

print("常见的 RTSP URL（需要开启 RTSP 功能）：")
for url in rtsp_urls:
    print(f"  - {url}")

# ============================================================
# 2. 测试 miIO 协议（需要 token）
# ============================================================
print("\n2. miIO 协议测试...")
print("小米摄像头使用 miIO 协议（UDP 54321）")
print("需要 token 才能与设备通信")

# 创建 miIO 发现包
def create_miio_discovery_packet():
    """创建 miIO 发现包"""
    # Magic bytes
    data = b'\x21\x31\x00\x20'
    # Padding
    data += b'\xff\xff\xff\xff\xff\xff\xff\xff'
    data += b'\xff\xff\xff\xff\xff\xff\xff\xff'
    data += b'\xff\xff\xff\xff\xff\xff\xff\xff'
    data += b'\xff\xff\xff\xff\xff\xff\xff\xff'
    return data

# 尝试发送发现包
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.settimeout(2)

try:
    packet = create_miio_discovery_packet()
    sock.sendto(packet, (TARGET_IP, UDP_PORT))
    print(f"✓ 发送发现包到 {TARGET_IP}:{UDP_PORT}")
    
    try:
        data, addr = sock.recvfrom(1024)
        print(f"✓ 收到响应: {len(data)} bytes")
        print(f"  响应数据: {data.hex()}")
    except socket.timeout:
        print("✗ 未收到响应（设备可能需要 token）")
except Exception as e:
    print(f"✗ 错误: {e}")
finally:
    sock.close()

# ============================================================
# 3. 测试其他已知端口
# ============================================================
print("\n3. 测试其他已知端口...")

ports_to_test = [
    (80, "HTTP", "TCP"),
    (443, "HTTPS", "TCP"),
    (554, "RTSP", "TCP"),
    (8080, "HTTP-Alt", "TCP"),
    (8443, "HTTPS-Alt", "TCP"),
    (8554, "RTSP-Alt", "TCP"),
    (9000, "Config", "TCP"),
    (9999, "Custom", "TCP"),
    (54321, "miIO", "UDP"),
]

for port, service, proto in ports_to_test:
    try:
        if proto == "TCP":
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result = sock.connect_ex((TARGET_IP, port))
            if result == 0:
                print(f"  ✓ {service} ({proto} {port}): 开放")
            else:
                print(f"  ✗ {service} ({proto} {port}): 关闭")
            sock.close()
        else:  # UDP
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(1)
            sock.sendto(b'\x00', (TARGET_IP, port))
            try:
                data, addr = sock.recvfrom(1024)
                print(f"  ✓ {service} ({proto} {port}): 有响应")
            except socket.timeout:
                print(f"  ? {service} ({proto} {port}): 无响应（UDP 可能正常）")
            sock.close()
    except Exception as e:
        print(f"  ✗ {service} ({proto} {port}): 错误 - {e}")

# ============================================================
# 4. 获取 token 的方法说明
# ============================================================
print("\n4. 获取设备 token 的方法：")
print("=" * 60)

token_methods = [
    {
        "name": "Xiaomi Cloud Tokens Extractor (推荐)",
        "url": "https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor",
        "method": "使用 Docker 运行，输入小米账号密码获取所有设备 token",
        "command": "docker run --rm -it pymoroni/xiaomi-cloud-tokens-extractor"
    },
    {
        "name": "从米家 App 提取",
        "url": "https://github.com/Maxmudjon/Get_MiHome_devices_token",
        "method": "使用修改版的米家 App 或抓包获取 token"
    },
    {
        "name": "hass-xiaomi-miot 插件",
        "url": "https://github.com/al-one/hass-xiaomi-miot",
        "method": "安装到 Home Assistant，通过集成界面登录获取 token"
    },
    {
        "name": "python-miio 云端 API",
        "url": "https://python-miio.readthedocs.io/",
        "method": "使用 micloud 库登录小米云端获取设备信息"
    }
]

for i, method in enumerate(token_methods, 1):
    print(f"\n方法 {i}: {method['name']}")
    print(f"  项目地址: {method['url']}")
    print(f"  说明: {method['method']}")
    if 'command' in method:
        print(f"  命令: {method['command']}")

# ============================================================
# 5. 开启 RTSP 的方法
# ============================================================
print("\n\n5. 开启摄像头 RTSP 功能的方法：")
print("=" * 60)
print("""
方法 1: 使用米家 App
  1. 打开米家 App，选择摄像头
  2. 进入设置 -> 存储管理
  3. 找到"RTSP 流"或"局域网传输"选项
  4. 开启后可以获得 RTSP URL 和端口

方法 2: 使用 miIO 命令（需要 token）
  miiocli chuangmicamera --ip 192.168.31.25 --token YOUR_TOKEN [command]
  
  可能的命令：
  - 开启 RTSP: camera.set_rtsp(True)
  - 获取流地址: camera.rtsp_url

方法 3: 修改摄像头固件（高级）
  - 解锁 bootloader
  - 刷入支持 RTSP 的固件
  - 风险较高，不推荐
""")

# ============================================================
# 6. 下一步建议
# ============================================================
print("\n6. 下一步行动建议：")
print("=" * 60)
print("""
优先级 1: 获取设备 token
  - 使用 Xiaomi Cloud Tokens Extractor 工具
  - 这是最关键的一步

优先级 2: 尝试开启 RTSP
  - 获取 token 后，使用 miiocli 尝试开启 RTSP
  - 或在米家 App 中查找相关设置

优先级 3: 研究 PTZ 控制
  - 确认 token 后，使用 genericmiot 接口探索 PTZ 属性
  - 参考 hass-xiaomi-miot 的实现

优先级 4: 备选方案
  - 如果 miIO 无法控制 PTZ，考虑使用云端 API
  - 或研究小米官方 HomeAssistant 集成
""")

print("\n" + "=" * 60)
print("测试完成")
print("=" * 60)
