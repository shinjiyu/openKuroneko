#!/usr/bin/env python3
"""
小米摄像头 Token 获取辅助脚本
目标设备: 192.168.31.25 (小米摄像头)
"""

import subprocess
import socket
import struct
import sys

CAMERA_IP = "192.168.31.25"
CAMERA_PORT = 54321

def test_device_online():
    """测试设备是否在线"""
    print(f"📡 测试设备连通性 ({CAMERA_IP})...")
    result = subprocess.run(["ping", "-c", "1", "-W", "1000", CAMERA_IP], 
                          capture_output=True)
    return result.returncode == 0

def test_miio_port():
    """测试 miIO 端口是否开放"""
    print(f"🔌 测试 UDP 端口 {CAMERA_PORT}...")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(3)
    
    # miIO discovery packet
    packet = bytes.fromhex("21310020ffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
    
    try:
        sock.sendto(packet, (CAMERA_IP, CAMERA_PORT))
        response, _ = sock.recvfrom(1024)
        if len(response) >= 32:
            device_id = struct.unpack(">I", response[8:12])[0]
            print(f"✅ 设备响应 miIO 协议")
            print(f"   设备 ID: 0x{device_id:08x}")
            return True
    except socket.timeout:
        print("❌ 设备未响应 miIO 发现包")
        return False
    finally:
        sock.close()
    return False

def run_token_extractor():
    """运行 token 提取工具"""
    print("\n" + "="*60)
    print("🔑 启动 Token 提取工具")
    print("="*60)
    print("\n请按提示操作：")
    print("1. 输入小米账号（手机号或邮箱）")
    print("2. 输入密码")
    print("3. 选择服务器地区: cn (中国区)")
    print("4. 可能需要短信验证码")
    print("\n" + "-"*60 + "\n")
    
    try:
        subprocess.run([sys.executable, "Xiaomi-cloud-tokens-extractor/token_extractor.py"])
    except KeyboardInterrupt:
        print("\n用户取消操作")
    except Exception as e:
        print(f"❌ 运行失败: {e}")
        print("\n尝试使用 Docker 方式:")
        print("docker run --rm -it pymoroni/xiaomi-cloud-tokens-extractor")

def main():
    print("="*60)
    print("  小米摄像头 Token 获取辅助脚本")
    print("  目标: 192.168.31.25")
    print("="*60 + "\n")
    
    # 步骤 1: 测试设备在线
    if not test_device_online():
        print("❌ 设备离线，请检查网络连接")
        return
    
    print("✅ 设备在线\n")
    
    # 步骤 2: 测试 miIO 协议
    if not test_miio_port():
        print("⚠️ miIO 协议测试失败，但继续尝试获取 token\n")
    
    # 步骤 3: 获取 token
    run_token_extractor()
    
    print("\n" + "="*60)
    print("📋 后续步骤:")
    print("1. 从输出中找到 IP 为 192.168.31.25 的设备")
    print("2. 复制其 Token（32 位十六进制字符串）")
    print("3. 运行以下命令验证:")
    print(f"   miiocli device --ip {CAMERA_IP} --token YOUR_TOKEN info")
    print("="*60)

if __name__ == "__main__":
    main()
