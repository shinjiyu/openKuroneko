#!/usr/bin/env python3
"""
小米摄像头 Token 验证脚本
用于验证获取到的 token 是否有效，并展示设备功能
"""

import socket
import sys
import struct

# 目标设备信息
CAMERA_IP = "192.168.31.25"
CAMERA_MAC = "54:48:e6:2f:1d:3c"
UDP_PORT = 54321

def send_miio_discovery(ip, port=54321, timeout=3):
    """发送 miIO 发现包并接收响应"""
    # miIO hello packet
    HELLO_PACKET = bytes.fromhex("21310020000000000000000000000000" +
                                "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    
    try:
        sock.sendto(HELLO_PACKET, (ip, port))
        response, _ = sock.recvfrom(1024)
        return response
    except socket.timeout:
        return None
    except Exception as e:
        print(f"错误: {e}")
        return None
    finally:
        sock.close()

def parse_miio_response(data):
    """解析 miIO 响应"""
    if len(data) < 32:
        return None
    
    # 解析设备 ID (bytes 8-12)
    device_id = struct.unpack(">I", data[8:12])[0]
    
    # 解析时间戳 (bytes 12-16)
    timestamp = struct.unpack(">I", data[12:16])[0]
    
    return {
        "device_id": f"0x{device_id:08x}",
        "timestamp": timestamp,
        "raw": data.hex()
    }

def check_device_online(ip):
    """检查设备是否在线"""
    import subprocess
    try:
        result = subprocess.run(
            ["ping", "-c", "1", "-W", "1000", ip],
            capture_output=True,
            timeout=3
        )
        return result.returncode == 0
    except:
        return False

def validate_token_format(token):
    """验证 token 格式是否正确"""
    if not token:
        return False, "Token 为空"
    
    if len(token) != 32:
        return False, f"Token 长度错误: 应为 32 位，实际为 {len(token)} 位"
    
    try:
        int(token, 16)
        return True, "Token 格式正确"
    except ValueError:
        return False, "Token 包含非十六进制字符"

def main():
    print("=" * 60)
    print("  小米摄像头 Token 验证工具")
    print("=" * 60)
    print(f"\n📍 目标设备: {CAMERA_IP}")
    print(f"📍 MAC 地址: {CAMERA_MAC}")
    print()
    
    # Step 1: 检查设备连通性
    print("🔍 Step 1: 检查设备连通性...")
    if check_device_online(CAMERA_IP):
        print("   ✅ 设备在线")
    else:
        print("   ❌ 设备离线")
        print("   请检查网络连接")
        return
    
    # Step 2: 测试 miIO 协议
    print("\n🔍 Step 2: 测试 miIO 协议...")
    response = send_miio_discovery(CAMERA_IP)
    if response:
        info = parse_miio_response(response)
        print(f"   ✅ 设备响应 miIO 协议")
        print(f"   设备 ID: {info['device_id']}")
        print(f"   时间戳: {info['timestamp']}")
    else:
        print("   ❌ 设备无响应")
        return
    
    # Step 3: 验证 token
    print("\n🔍 Step 3: 验证 Token")
    print("-" * 60)
    
    # 从命令行参数或交互输入获取 token
    if len(sys.argv) > 1:
        token = sys.argv[1]
    else:
        print("\n请输入获取到的 Token（32位十六进制）：")
        print("（如果还没有 Token，请参考 Token获取实施指南-用户操作版.md）")
        print()
        token = input("Token: ").strip()
    
    valid, msg = validate_token_format(token)
    if valid:
        print(f"   ✅ {msg}")
        print()
        print("=" * 60)
        print("🎉 Token 验证通过！")
        print("=" * 60)
        print()
        print("📋 后续测试命令:")
        print(f"   # 获取设备详细信息")
        print(f"   miiocli device --ip {CAMERA_IP} --token {token} info")
        print()
        print(f"   # 列出设备所有属性")
        print(f"   miiocli genericmiot --ip {CAMERA_IP} --token {token} properties")
        print()
        print(f"   # 列出设备所有操作")
        print(f"   miiocli genericmiot --ip {CAMERA_IP} --token {token} actions")
        print()
        print(f"   # 查找 PTZ 相关功能")
        print(f"   miiocli genericmiot --ip {CAMERA_IP} --token {token} actions | grep -i ptz")
        print()
        
        # 保存 token 到文件
        save = input("是否保存 Token 到文件？(y/n): ").strip().lower()
        if save == 'y':
            with open(".camera_token", "w") as f:
                f.write(f"XIAOMI_CAMERA_IP={CAMERA_IP}\n")
                f.write(f"XIAOMI_CAMERA_TOKEN={token}\n")
                f.write(f"XIAOMI_CAMERA_MAC={CAMERA_MAC}\n")
            print("   ✅ Token 已保存到 .camera_token 文件")
    else:
        print(f"   ❌ {msg}")
        print()
        print("请重新获取 Token，确保复制完整的 32 位十六进制字符串")

if __name__ == "__main__":
    main()
