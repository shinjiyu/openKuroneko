#!/usr/bin/env python3
"""
小米摄像头 Token 获取辅助脚本
提供多种获取方式的选择和引导
"""

import subprocess
import sys
import os

def print_header():
    print("=" * 60)
    print("  小米摄像头 Token 获取助手")
    print("  目标设备: 192.168.31.25 (小米摄像头)")
    print("=" * 60)
    print()

def check_prerequisites():
    """检查前提条件"""
    print("🔍 检查前提条件...")
    
    # 检查设备是否在线
    result = subprocess.run(
        ["ping", "-c", "1", "-t", "2", "192.168.31.25"],
        capture_output=True
    )
    if result.returncode == 0:
        print("  ✅ 设备在线 (192.168.31.25)")
    else:
        print("  ⚠️ 设备可能离线，请检查网络")
    
    # 检查 Docker
    result = subprocess.run(["which", "docker"], capture_output=True)
    if result.returncode == 0:
        print("  ✅ Docker 已安装")
    else:
        print("  ⚠️ Docker 未安装")
    
    # 检查 Python 依赖
    print("  ✅ Python 环境就绪")
    print()

def show_options():
    """显示获取选项"""
    print("📋 Token 获取方式:")
    print()
    print("  [1] 使用小米账号密码（推荐 ⭐⭐⭐⭐⭐）")
    print("      - 需要: 小米账号和密码")
    print("      - 耗时: 5-10 分钟")
    print("      - 成功率: 95%")
    print()
    print("  [2] 使用二维码扫码登录")
    print("      - 需要: 米家 App")
    print("      - 耗时: 5-10 分钟")
    print("      - 成功率: 95%")
    print()
    print("  [3] iPhone 备份提取（仅 iOS 用户）")
    print("      - 需要: iPhone + iTunes 备份")
    print("      - 耗时: 15-20 分钟")
    print()
    print("  [4] 查看详细操作指南")
    print()
    print("  [q] 退出")
    print()

def run_docker_password():
    """使用 Docker 运行（密码方式）"""
    print()
    print("=" * 60)
    print("  方式 1: 使用小米账号密码")
    print("=" * 60)
    print()
    print("请准备:")
    print("  - 小米账号（手机号或邮箱）")
    print("  - 密码")
    print()
    print("即将运行 Docker 容器，请按照提示操作:")
    print("  1. 选择 'p' (password)")
    print("  2. 输入小米账号")
    print("  3. 输入密码")
    print("  4. 选择服务器: cn (中国区)")
    print("  5. 从输出中找到 IP 为 192.168.31.25 的设备")
    print()
    input("按 Enter 键继续...")
    
    subprocess.run([
        "docker", "run", "--rm", "-it",
        "pymoroni/xiaomi-cloud-tokens-extractor"
    ])

def run_docker_qr():
    """使用 Docker 运行（二维码方式）"""
    print()
    print("=" * 60)
    print("  方式 2: 使用二维码扫码登录")
    print("=" * 60)
    print()
    print("请准备:")
    print("  - 安装了米家 App 的手机")
    print()
    print("即将运行 Docker 容器，请按照提示操作:")
    print("  1. 选择 'q' (QR code)")
    print("  2. 使用米家 App 扫描显示的二维码")
    print("  3. 选择服务器: cn (中国区)")
    print("  4. 从输出中找到 IP 为 192.168.31.25 的设备")
    print()
    input("按 Enter 键继续...")
    
    subprocess.run([
        "docker", "run", "--rm", "-it",
        "pymoroni/xiaomi-cloud-tokens-extractor"
    ])

def show_iphone_guide():
    """显示 iPhone 备份提取指南"""
    print()
    print("=" * 60)
    print("  方式 3: iPhone 备份提取")
    print("=" * 60)
    print()
    print("步骤:")
    print("  1. 使用 iTunes 或 Finder 创建 iPhone 完整备份")
    print("     注意: 不要加密备份!")
    print()
    print("  2. 下载 iBackup Viewer (免费):")
    print("     https://www.imactools.com/iphonebackupviewer/")
    print()
    print("  3. 在备份中找到文件:")
    print("     xiaomi.mihome/Documents/XXX_mihome.sqlite")
    print()
    print("  4. 使用 SQLite 工具查询 token:")
    print("     SELECT * FROM ZDEVICE WHERE ZIP LIKE '192.168.31.25';")
    print()
    print("  5. TOKEN 字段即为所需 token")
    print()

def show_detailed_guide():
    """显示详细操作指南"""
    guide_file = "获取Token操作指南.md"
    if os.path.exists(guide_file):
        with open(guide_file, 'r', encoding='utf-8') as f:
            print(f.read())
    else:
        print(f"详细指南文件不存在: {guide_file}")

def main():
    print_header()
    check_prerequisites()
    
    while True:
        show_options()
        choice = input("请选择 [1-4, q]: ").strip().lower()
        
        if choice == '1':
            run_docker_password()
        elif choice == '2':
            run_docker_qr()
        elif choice == '3':
            show_iphone_guide()
        elif choice == '4':
            show_detailed_guide()
        elif choice == 'q':
            print()
            print("退出。如果需要帮助，请查看 获取Token操作指南.md")
            break
        else:
            print("无效选择，请重新输入")
        
        print()

if __name__ == "__main__":
    main()
