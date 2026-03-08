#!/usr/bin/env python3
"""
小米设备 Token 简易提取工具
基于 micloud 库
"""

import sys
import os

# 添加工作目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from micloud import MiCloud
    from micloud.micloudexception import MiCloudException
except ImportError:
    print("❌ 请先安装 micloud 库:")
    print("   pip3 install micloud")
    sys.exit(1)

def get_devices_with_tokens(username, password, server="cn"):
    """
    获取所有设备及其 token
    
    Args:
        username: 小米账号（手机号或邮箱）
        password: 密码
        server: 服务器地区 (cn/de/us/ru/tw/sg/in/i2)
    
    Returns:
        设备列表
    """
    try:
        print(f"\n🔐 正在登录小米账号 ({username})...")
        mc = MiCloud(username, password)
        mc.login()
        
        print(f"✅ 登录成功!")
        print(f"\n📡 正在获取设备列表 (服务器: {server})...")
        
        devices = mc.get_devices(server)
        
        return devices
        
    except MiCloudException as e:
        print(f"❌ 登录失败: {e}")
        return None
    except Exception as e:
        print(f"❌ 发生错误: {e}")
        return None


def find_camera_device(devices, target_ip="192.168.31.25"):
    """
    在设备列表中查找目标摄像头
    """
    for device in devices:
        if device.get("localip") == target_ip:
            return device
    return None


def main():
    print("=" * 60)
    print("  小米设备 Token 简易提取工具")
    print("  目标设备: 192.168.31.25 (小米摄像头)")
    print("=" * 60)
    
    # 检查命令行参数
    if len(sys.argv) >= 3:
        username = sys.argv[1]
        password = sys.argv[2]
        server = sys.argv[3] if len(sys.argv) >= 4 else "cn"
    else:
        print("\n用法:")
        print(f"  python3 {sys.argv[0]} <用户名> <密码> [服务器地区]")
        print("\n参数:")
        print("  用户名    - 小米账号（手机号或邮箱）")
        print("  密码      - 小米账号密码")
        print("  服务器    - cn(中国)/de(德国)/us(美国)/tw(台湾)/sg(新加坡)")
        print("\n示例:")
        print(f"  python3 {sys.argv[0]} 13800138000 mypassword cn")
        print("\n" + "=" * 60)
        print("\n⚠️  注意: 您需要提供小米账号和密码才能获取 token")
        print("    这是获取 token 的必要条件，无法绕过")
        print("\n💡 如果您不想提供账号密码，可以尝试:")
        print("    1. 使用米家 App 扫码登录 (Docker 方式)")
        print("    2. 通过 iPhone 备份提取 (需要 iOS 设备)")
        print("    3. 使用安卓旧版米家 App (v5.4.54)")
        print("=" * 60)
        sys.exit(1)
    
    # 获取设备列表
    devices = get_devices_with_tokens(username, password, server)
    
    if not devices:
        print("\n❌ 未能获取设备列表")
        sys.exit(1)
    
    print(f"\n✅ 找到 {len(devices)} 个设备\n")
    
    # 查找目标摄像头
    camera = find_camera_device(devices, "192.168.31.25")
    
    if camera:
        print("=" * 60)
        print("🎯 找到目标摄像头!")
        print("=" * 60)
        print(f"名称:    {camera.get('name', 'N/A')}")
        print(f"型号:    {camera.get('model', 'N/A')}")
        print(f"IP:      {camera.get('localip', 'N/A')}")
        print(f"MAC:     {camera.get('mac', 'N/A')}")
        print(f"DID:     {camera.get('did', 'N/A')}")
        print(f"Token:   {camera.get('token', 'N/A')}")
        print("=" * 60)
        
        # 保存 token
        token = camera.get('token')
        if token:
            with open('.xiaomi_camera_token', 'w') as f:
                f.write(token)
            print(f"\n✅ Token 已保存到 .xiaomi_camera_token 文件")
            
            print("\n📋 验证命令:")
            print(f"   miiocli device --ip 192.168.31.25 --token {token} info")
    else:
        print("⚠️  未找到 IP 为 192.168.31.25 的设备")
        print("\n所有设备列表:")
        for i, device in enumerate(devices, 1):
            print(f"\n{i}. {device.get('name', 'N/A')}")
            print(f"   型号: {device.get('model', 'N/A')}")
            print(f"   IP:   {device.get('localip', 'N/A')}")
            print(f"   Token: {device.get('token', 'N/A')}")


if __name__ == "__main__":
    main()
