# 实例间通信机制（Inter-Instance Communication）

## 背景

openKuroneko 支持多实例并行运行（基于路径锁隔离），但实例之间缺乏通信机制。
本方案建立原实例与副本实例之间的信息交换通道。

## 当前实例状态

- **原实例（Kuroneko）**：
  - 外脑目录：`/Users/user/Documents/openKuroneko/ob-agent`
  - 内脑目录：`/Users/user/Documents/openKuroneko/chat-agent`
  - WebChat 端口：8091
  - PID：53762

- **副本实例（Kuroneko-Replica）**：
  - 外脑目录：`/Users/user/Documents/openKuroneko/ob-agent-replica`
  - 内脑目录：`/Users/user/Documents/openKuroneko/chat-agent-replica`
  - WebChat 端口：8092
  - PID：92367

## 通信方案

### 方案 1：共享文件系统 IPC（已实现）

**目录结构**：
```
/tmp/openKuroneko-ipc/
├── instances/
│   ├── kuroneko.json          # 原实例元数据
│   └── kuroneko-replica.json  # 副本实例元数据
└── channels/
    ├── default/               # 默认通信通道
    │   ├── inbox-kuroneko.json
    │   └── inbox-kuroneko-replica.json
    └── broadcast/             # 广播通道
        └── messages.jsonl
```

**元数据格式**（instances/*.json）：
```json
{
  "id": "kuroneko",
  "name": "Kuroneko",
  "webchatPort": 8091,
  "obDir": "/Users/user/Documents/openKuroneko/ob-agent",
  "innerDir": "/Users/user/Documents/openKuroneko/chat-agent",
  "pid": 53762,
  "startedAt": "2026-03-07T16:16:00Z",
  "status": "RUNNING"
}
```

**消息格式**（inbox-*.json）：
```json
[
  {
    "id": "msg-1234567890",
    "from": "kuroneko-replica",
    "to": "kuroneko",
    "type": "query" | "command" | "notification",
    "payload": { ... },
    "timestamp": "2026-03-07T16:40:00Z",
    "read": false
  }
]
```

### 方案 2：HTTP API（待实现）

在 WebChat 服务器中添加 API 端点：
- `GET /api/instances` - 列出所有已知实例
- `POST /api/messages` - 发送消息给目标实例
- `GET /api/messages` - 获取本实例的消息队列

## 使用方式

### 注册实例
```bash
# 原实例注册
cat > /tmp/openKuroneko-ipc/instances/kuroneko.json << 'EOF'
{
  "id": "kuroneko",
  "name": "Kuroneko",
  "webchatPort": 8091,
  "obDir": "/Users/user/Documents/openKuroneko/ob-agent",
  "innerDir": "/Users/user/Documents/openKuroneko/chat-agent",
  "pid": 53762,
  "startedAt": "2026-03-07T16:16:00Z",
  "status": "RUNNING"
}
EOF

# 副本实例注册
cat > /tmp/openKuroneko-ipc/instances/kuroneko-replica.json << 'EOF'
{
  "id": "kuroneko-replica",
  "name": "Kuroneko-Replica",
  "webchatPort": 8092,
  "obDir": "/Users/user/Documents/openKuroneko/ob-agent-replica",
  "innerDir": "/Users/user/Documents/openKuroneko/chat-agent-replica",
  "pid": 92367,
  "startedAt": "2026-03-07T16:36:00Z",
  "status": "RUNNING"
}
EOF
```

### 发送消息
```bash
# 从原实例向副本发送消息
jq '. + [{"id": "msg-'$(date +%s)'", "from": "kuroneko", "to": "kuroneko-replica", "type": "notification", "payload": {"text": "Hello from Kuroneko!"}, "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'", "read": false}]' \
  /tmp/openKuroneko-ipc/channels/default/inbox-kuroneko-replica.json \
  > /tmp/tmp-inbox.json && mv /tmp/tmp-inbox.json /tmp/openKuroneko-ipc/channels/default/inbox-kuroneko-replica.json
```

### 读取消息
```bash
# 副本实例读取消息
jq '.[] | select(.read == false)' /tmp/openKuroneko-ipc/channels/default/inbox-kuroneko-replica.json
```

## 消息类型

1. **query**：查询请求，期望回复
   ```json
   {
     "type": "query",
     "payload": {
       "question": "What is your current goal?",
       "replyTo": "msg-xxx"
     }
   }
   ```

2. **command**：指令消息，要求执行
   ```json
   {
     "type": "command",
     "payload": {
       "action": "pause",
       "reason": "System maintenance"
     }
   }
   ```

3. **notification**：通知消息，单向通知
   ```json
   {
     "type": "notification",
     "payload": {
       "event": "milestone_completed",
       "data": { "milestone": "M1" }
     }
   }
   ```

## 下一步

1. **集成到外脑工具集**：
   - 创建 `send_instance_message` 工具
   - 创建 `read_instance_messages` 工具
   - 创建 `list_instances` 工具

2. **集成到 PushLoop**：
   - 定期检查 inbox
   - 收到消息后触发通知或直接处理

3. **增强安全性**：
   - 消息签名验证
   - 访问控制列表

4. **性能优化**：
   - 使用文件锁避免并发冲突
   - 消息压缩和清理机制
