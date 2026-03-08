# 局域网小米设备探测与识别

> category: shell | id: skill-6eda | 2026-03-08T15:50:48.269Z

场景：需要在局域网中发现并识别小米智能设备（摄像头、空调、插座等），获取 IP、MAC、设备类型等信息

步骤：
1. 使用 `miiocli discover` 扫描局域网中的 miIO 设备（UDP 54321 端口）
2. 使用 `nmap -sn 192.168.x.0/24` 进行主机存活扫描，或使用 `arp -a` 获取 ARP 表
3. 通过 MAC 地址厂商 API（如 https://api.macvendors.com/{MAC}）查询设备制造商
4. 结合厂商信息判断设备类型：
   - Shanghai Imilab Technology → 小米摄像头
   - Beijing Xiaomi Mobile Software → 其他小米智能设备
5. 可选：发送 miIO hello 包获取设备 ID 和运行时间戳

验证：
- 能够列出局域网中所有小米设备及其厂商信息
- 至少识别出一台小米摄像头设备（如有）
