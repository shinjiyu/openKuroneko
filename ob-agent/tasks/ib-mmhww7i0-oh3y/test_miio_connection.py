#!/usr/bin/env python3
"""测试小米摄像头 miIO 连接"""

import socket
import struct
import json
import hashlib
from datetime import datetime

# 目标设备（疑似摄像头）
TARGET_IP = "192.168.31.25"
MIIO_PORT = 54321

def create_miio_packet(command, token=None):
    """创建 miIO 协议数据包"""
    # miIO 数据包结构：
    # - 2 bytes: magic number (0x2131)
    # - 2 bytes: length
    # - 4 bytes: unknown
    # - 4 bytes: device ID
    # - 4 bytes: timestamp
    # - 16 bytes: checksum (MD5)
    # - variable: payload
    
    magic = struct.pack("!H", 0x2131)
    unknown = struct.pack("!I", 0x00000000)
    device_id = struct.pack("!I", 0xFFFFFFFF)  # 广播
    timestamp = struct.pack("!I", int(datetime.now().timestamp()))
    
    # 构建payload
    if isinstance(command, dict):
        payload = json.dumps(command).encode('utf-8')
    else:
        payload = command.encode('utf-8')
    
    # 计算完整包长度
    packet_len = 2 + 2 + 4 + 4 + 4 + 16 + len(payload)
    length = struct.pack("!H", packet_len)
    
    # 构建校验和前的数据
    data_before_checksum = magic + length + unknown + device_id + timestamp
    
    # 如果有 token，使用 token 计算 checksum
    if token:
        token_bytes = bytes.fromhex(token) if isinstance(token, str) else token
        checksum_data = data_before_checksum + token_bytes + payload
        checksum = hashlib.md5(checksum_data).digest()
    else:
        # 没有token，使用16字节的0
        checksum = b'\x00' * 16
    
    # 组装完整数据包
    packet = data_before_checksum + checksum + payload
    
    return packet

def send_miio_discovery():
    """发送 miIO 发现包"""
    # 发送广播发现包
    discovery_packet = create_miio_packet({"method": "miIO.info", "params": []})
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(3)
    
    try:
        sock.sendto(discovery_packet, (TARGET_IP, MIIO_PORT))
        print(f"✓ 发送发现包到 {TARGET_IP}:{MIIO_PORT}")
        
        response, addr = sock.recvfrom(4096)
        print(f"✓ 收到响应，长度: {len(response)} bytes")
        
        # 解析响应
        if len(response) >= 32:
            magic = struct.unpack("!H", response[0:2])[0]
            length = struct.unpack("!H", response[2:4])[0]
            device_id = struct.unpack("!I", response[8:12])[0]
            timestamp = struct.unpack("!I", response[12:16])[0]
            
            print(f"  Magic: 0x{magic:04x}")
            print(f"  Length: {length}")
            print(f"  Device ID: 0x{device_id:08x}")
            print(f"  Timestamp: {timestamp}")
            
            if len(response) > 32:
                payload = response[32:].decode('utf-8', errors='ignore')
                print(f"  Payload: {payload}")
        
        return response
    except socket.timeout:
        print("✗ 超时，未收到响应")
        return None
    except Exception as e:
        print(f"✗ 错误: {e}")
        return None
    finally:
        sock.close()

def test_miio_handshake():
    """测试 miIO 握手"""
    # 发送一个简单的握手包
    handshake_packet = create_miio_packet({"method": "miIO.info", "id": 1})
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(5)
    
    try:
        sock.sendto(handshake_packet, (TARGET_IP, MIIO_PORT))
        print(f"\n测试握手: {TARGET_IP}:{MIIO_PORT}")
        
        response, addr = sock.recvfrom(4096)
        print(f"✓ 握手成功！收到 {len(response)} bytes")
        
        # 尝试解析 JSON payload
        if len(response) > 32:
            try:
                payload = response[32:].decode('utf-8')
                data = json.loads(payload)
                print(f"设备响应: {json.dumps(data, indent=2, ensure_ascii=False)}")
            except:
                print(f"原始响应 (hex): {response.hex()}")
        
        return True
    except socket.timeout:
        print("✗ 握手超时")
        return False
    except Exception as e:
        print(f"✗ 握手错误: {e}")
        return False
    finally:
        sock.close()

def scan_all_cameras():
    """扫描所有疑似摄像头设备"""
    candidates = [
        "192.168.31.25",  # Imilab 厂商
        "192.168.31.48",
        "192.168.31.115",
        "192.168.31.156"
    ]
    
    print("=" * 60)
    print("扫描所有小米设备")
    print("=" * 60)
    
    for ip in candidates:
        print(f"\n正在测试 {ip}...")
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(2)
        
        try:
            # 发送简单的 ping 包
            packet = create_miio_packet({"method": "miIO.info", "id": 1})
            sock.sendto(packet, (ip, MIIO_PORT))
            
            response, addr = sock.recvfrom(4096)
            print(f"  ✓ {ip} 响应正常")
            
            if len(response) > 32:
                try:
                    payload = response[32:].decode('utf-8')
                    data = json.loads(payload)
                    if 'result' in data:
                        print(f"  设备信息: {json.dumps(data['result'], indent=4, ensure_ascii=False)}")
                except:
                    pass
        except socket.timeout:
            print(f"  ✗ {ip} 无响应（超时）")
        except Exception as e:
            print(f"  ✗ {ip} 错误: {e}")
        finally:
            sock.close()

if __name__ == "__main__":
    print("小米摄像头 miIO 连接测试")
    print("=" * 60)
    print(f"目标设备: {TARGET_IP}")
    print(f"miIO 端口: {MIIO_PORT} (UDP)")
    print("=" * 60)
    
    # 测试连接
    print("\n1. 测试 UDP 连接...")
    send_miio_discovery()
    
    # 测试握手
    print("\n2. 测试 miIO 握手...")
    test_miio_handshake()
    
    # 扫描所有设备
    print("\n3. 扫描所有设备...")
    scan_all_cameras()
    
    print("\n" + "=" * 60)
    print("测试完成")
    print("=" * 60)
