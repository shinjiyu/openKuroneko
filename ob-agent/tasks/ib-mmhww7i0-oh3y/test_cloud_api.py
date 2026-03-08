#!/usr/bin/env python3
"""
小米云端 API 测试 - 获取设备 token
参考: https://github.com/Syssi/xiaomi-cloud-tokens-extractor
"""

import requests
import json
import hashlib
import random
import time

class XiaomiCloudApi:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Android-7.1.1-1.0.0-ONEPLUS A3010-136-%s APP/xiaomi.smarthome APPV/62830' % random.randint(100, 999),
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate',
            'Accept-Language': 'zh-Hans-CN;q=1'
        })
        self.auth = None
        
    def login(self, username, password):
        """登录小米账号"""
        print(f"尝试登录小米账号: {username}")
        
        # 第一步：获取登录信息
        url = "https://account.xiaomi.com/pass/serviceLogin"
        params = {
            'sid': 'xiaomihome',
            '_json': 'true'
        }
        
        try:
            response = self.session.get(url, params=params)
            print(f"登录页面响应: {response.status_code}")
            
            if response.status_code == 200:
                data = response.text
                if data.startswith('&&&START&&&'):
                    data = data[11:]
                login_info = json.loads(data)
                print(f"登录信息: {json.dumps(login_info, indent=2, ensure_ascii=False)}")
                
                # 提示用户需要完成登录
                print("\n注意：小米账号登录需要两步验证，建议使用以下方法之一获取 token：")
                print("1. 使用 Xiaomi Cloud Tokens Extractor: https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor")
                print("2. 从米家 App 备份文件提取")
                print("3. 使用抓包工具（mitmproxy）拦截米家 App 流量")
                
                return False
        except Exception as e:
            print(f"登录失败: {e}")
            return False
            
        return False
    
    def get_devices(self, server_url, user_id, security_token):
        """获取设备列表"""
        url = f"{server_url}/home/device_list"
        params = {
            'data': json.dumps({
                'userId': user_id,
                'securityToken': security_token,
                'did': '',
                'model': ''
            })
        }
        
        try:
            response = self.session.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                return data
        except Exception as e:
            print(f"获取设备列表失败: {e}")
            
        return None

def main():
    print("=" * 60)
    print("小米云端 API 测试")
    print("=" * 60)
    
    api = XiaomiCloudApi()
    
    print("\n提示：要获取设备 token，你需要：")
    print("1. 小米账号的用户名和密码")
    print("2. 可能需要短信验证码")
    print("\n由于登录过程复杂，建议使用以下工具：")
    print("- Xiaomi Cloud Tokens Extractor (Docker)")
    print("- hass-xiaomi-miot 插件")
    print("\n或者手动提供 token 进行测试")
    
    # 检查是否有环境变量提供的凭据
    import os
    username = os.environ.get('XIAOMI_USERNAME', '')
    password = os.environ.get('XIAOMI_PASSWORD', '')
    
    if username and password:
        api.login(username, password)
    else:
        print("\n未检测到环境变量 XIAOMI_USERNAME 和 XIAOMI_PASSWORD")
        print("如需测试登录，请设置这些环境变量")
    
    print("\n" + "=" * 60)
    print("测试完成")
    print("=" * 60)

if __name__ == "__main__":
    main()
