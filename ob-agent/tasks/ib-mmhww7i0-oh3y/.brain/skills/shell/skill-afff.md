# 局域网小米设备探测（无需认证）

> category: shell | id: skill-afff | 2026-03-08T15:51:36.772Z

场景：需要在局域网中发现小米智能设备（包括摄像头），但无设备 token 无法通过 miIO 协议获取详细信息时
步骤：
  1. 使用 `miiocli discover` 广播发现局域网内所有 miIO 设备（UDP 54321）
  2. 使用 `arp -a | grep "192.168"` 获取设备 MAC 地址
  3. 通过 MAC 地址厂商查询 API（api.macvendors.com）识别设备制造商
  4. 重点关注厂商为 "Shanghai Imilab Technology Co.Ltd" 的设备（小米摄像头制造商）
  5. 使用 `nc -vzu <IP> 54321` 验证 UDP 端口开放状态
  6. 使用 Python socket 发送 miIO discovery packet（0x21310020...）获取设备 ID 和握手信息
验证：
  - 能够列出局域网内所有小米设备的 IP 地址
  - 能够识别出哪些设备可能是摄像头（通过 MAC 厂商）
  - 确认设备 UDP 54321 端口响应
