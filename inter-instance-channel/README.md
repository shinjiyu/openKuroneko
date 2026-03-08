# 实例间通信系统 (Inter-Instance Communication System)

## 📋 概述

本系统提供了 openKuroneko 多实例之间的消息传递和协调机制。允许不同的 Agent 实例通过共享文件系统进行异步通信。

## 🏗️ 架构

```
inter-instance-channel/
├── queue/                    # 消息队列（待处理）
├── processed/                # 已处理消息
├── instances/                # 实例注册表
│   ├── kuroneko-original/
│   │   └── status.json
│   └── kuroneko-replica/
│       └── status.json
├── send_message.sh           # 发送消息
├── receive_messages.sh       # 接收消息
├── message_processor.sh      # 自动处理消息
├── monitor.sh                # 持续监控（可选）
├── update_heartbeat.sh       # 更新心跳
└── query_status.sh           # 查询状态
```

## 🚀 快速开始

### 1. 注册实例

```bash
# 注册原实例
./register_instance.sh kuroneko-original \
  /Users/user/Documents/openKuroneko/chat-agent \
  8091 primary

# 注册副本实例
./register_instance.sh kuroneko-replica \
  /Users/user/Documents/openKuroneko/chat-agent-replica \
  8092 replica
```

### 2. 发送消息

```bash
# 发送任务请求
./send_message.sh kuroneko-original kuroneko-replica task_request \
  '{"task":"analyze_logs","priority":"high"}'

# 发送状态报告
./send_message.sh kuroneko-replica kuroneko-original status_report \
  '{"status":"idle","resources":{"cpu":"20%","memory":"256MB"}}'

# 发送任务分配
./send_message.sh kuroneko-original kuroneko-replica task_assignment \
  '{"task_id":"task-001","description":"探索源码结构","priority":"high"}'
```

### 3. 接收消息

```bash
# 查看待处理消息
./receive_messages.sh kuroneko-replica

# 处理消息（不自动回复）
./message_processor.sh kuroneko-replica

# 处理消息（自动回复）
./message_processor.sh kuroneko-replica --auto-reply
```

### 4. 更新心跳

```bash
# 定期更新实例活跃状态
./update_heartbeat.sh kuroneko-original
./update_heartbeat.sh kuroneko-replica
```

## 📨 消息类型

### 支持的消息类型

| 类型 | 用途 | 示例 |
|------|------|------|
| `task_request` | 请求其他实例执行任务 | `{"task":"analyze","priority":"high"}` |
| `task_assignment` | 分配任务给其他实例 | `{"task_id":"t-001","description":"..."}` |
| `task_result` | 返回任务执行结果 | `{"task_id":"t-001","status":"success","result":{...}}` |
| `status_report` | 报告实例状态 | `{"status":"busy","progress":50}` |
| `ack` | 确认收到消息 | `{"original_msg":"msg-xxx","status":"received"}` |
| `query` | 查询信息 | `{"query":"get_milestones"}` |
| `response` | 响应查询 | `{"query_id":"q-xxx","data":{...}}` |

### 消息格式

```json
{
  "id": "msg-1772901888-12345",
  "timestamp": "2026-03-07T16:44:48.300Z",
  "from": "kuroneko-original",
  "to": "kuroneko-replica",
  "type": "task_request",
  "payload": {
    "task": "analyze_logs",
    "priority": "high"
  }
}
```

## 🔄 工作流程

### 基本流程

```
┌─────────────────┐         ┌─────────────────┐
│  Original       │         │  Replica        │
│  (Primary)      │         │  (Secondary)    │
└────────┬────────┘         └────────┬────────┘
         │                           │
         │  1. 发送任务分配           │
         │  ───────────────────>     │
         │                           │
         │                           │  2. 处理任务
         │                           │
         │  3. 返回任务结果           │
         │  <───────────────────     │
         │                           │
         │  4. 确认收到               │
         │  ───────────────────>     │
         │                           │
```

### 高级流程（并行协作）

```
Original: "我需要分析日志，Replica 你能帮忙吗？"
   ↓
发送 task_request 到 Replica
   ↓
Replica: "收到，我处理 1-100 行，你处理 101-200 行"
   ↓
发送 task_assignment 回 Original
   ↓
双方并行处理各自部分
   ↓
Replica: "我完成了，这是结果"
   ↓
Original: "收到，我也完成了，合并结果..."
   ↓
任务完成
```

## 🛠️ 集成到 Agent

### 在 .brain/constraints.md 中添加

```markdown
## 实例间通信约定
- 使用 /Users/user/Documents/openKuroneko/inter-instance-channel/ 发送和接收消息
- 每次执行前检查是否有新消息（receive_messages.sh）
- 处理消息后移动到 processed/ 目录
- 定期更新心跳（update_heartbeat.sh）
- 消息格式必须符合标准 JSON 格式
```

### 在 .brain/skills.md 中添加

```markdown
# 实例间消息处理

场景：需要与其他 Agent 实例协作

步骤：
1. 检查待处理消息：./receive_messages.sh <instance_id>
2. 处理消息：./message_processor.sh <instance_id> --auto-reply
3. 发送新消息：./send_message.sh <from> <to> <type> <payload>
4. 更新心跳：./update_heartbeat.sh <instance_id>
```

## 📊 监控和调试

### 查看所有实例状态

```bash
ls -la instances/
cat instances/*/status.json | jq .
```

### 查看消息队列

```bash
# 待处理消息
ls -la queue/

# 已处理消息
ls -la processed/

# 查看特定消息
cat queue/msg-xxx.json | jq .
```

### 持续监控（后台）

```bash
# 每 5 秒检查一次
./monitor.sh kuroneko-replica 5 &

# 查看日志
tail -f /tmp/inter-instance-monitor.log
```

## ⚠️ 注意事项

1. **消息顺序**：消息按照文件系统顺序处理，不保证严格的时间顺序
2. **并发安全**：使用文件锁（mv 原子操作）避免并发冲突
3. **消息持久化**：消息保存在文件系统中，实例重启后仍可恢复
4. **清理策略**：定期清理 processed/ 目录中的旧消息
5. **错误处理**：消息格式错误时跳过该消息，不影响其他消息处理

## 🔧 故障排查

### 消息未被处理

```bash
# 检查实例是否注册
cat instances/kuroneko-original/status.json

# 检查消息目标是否正确
cat queue/msg-xxx.json | grep '"to"'

# 手动处理
./message_processor.sh kuroneko-original
```

### 实例离线

```bash
# 检查心跳时间
cat instances/kuroneko-original/status.json | jq .last_heartbeat

# 更新心跳
./update_heartbeat.sh kuroneko-original
```

## 📚 相关文档

- [通信架构设计](../chat-agent/doc/inter-instance-communication.md)
- [消息协议规范](../chat-agent/doc/messaging-protocol.md)

## 🤝 贡献

欢迎扩展消息类型和通信协议！建议：
1. 添加新的消息类型到协议规范
2. 在 message_processor.sh 中添加新类型的处理逻辑
3. 更新文档说明新类型的使用方法
