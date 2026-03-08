# 实例间通信协议 v1.0

## 概述

openKuroneko 实例间通信系统允许独立运行的 agent 实例进行可靠的消息交换，适用于：
- 多实例协作任务
- 实例状态同步
- 跨实例指令传递
- 分布式工作负载

## 通信架构

### 目录结构

```
/Users/user/Documents/openKuroneko/.instance-messaging/
├── inbox-kuroneko/      # Kuroneko 主实例的收件箱
├── inbox-replica/       # Replica 副本实例的收件箱
├── outbox-kuroneko/     # Kuroneko 主实例的发件箱（已发送）
└── outbox-replica/      # Replica 副本实例的发件箱（已发送）
```

### 消息格式

每条消息是一个 JSON 文件，格式如下：

```json
{
  "id": "msg-1736242800000-abc123",
  "from": "kuroneko",
  "to": "replica",
  "timestamp": "2026-03-07T16:40:00.000Z",
  "type": "directive | status | query | response | notification",
  "priority": "high | normal | low",
  "requires_ack": true,
  "ack_deadline": "2026-03-07T16:45:00.000Z",
  "payload": {
    "action": "string",
    "data": "any"
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一消息 ID（时间戳 + 随机串） |
| from | string | 发送方实例名（kuroneko / replica） |
| to | string | 接收方实例名（kuroneko / replica） |
| timestamp | ISO8601 | 消息创建时间 |
| type | enum | 消息类型（见下文） |
| priority | enum | 优先级（high 优先处理） |
| requires_ack | boolean | 是否需要确认 |
| ack_deadline | ISO8601 | 确认截止时间（requires_ack=true 时） |
| payload.action | string | 具体动作/指令 |
| payload.data | any | 动作参数 |

### 消息类型

#### 1. directive（指令）
发送执行指令给目标实例
```json
{
  "type": "directive",
  "payload": {
    "action": "update_goal",
    "data": {
      "new_goal": "协作完成代码审查"
    }
  }
}
```

#### 2. status（状态同步）
同步实例状态信息
```json
{
  "type": "status",
  "payload": {
    "action": "milestone_completed",
    "data": {
      "milestone_id": "M3",
      "duration_ms": 12345
    }
  }
}
```

#### 3. query（查询）
请求目标实例返回信息
```json
{
  "type": "query",
  "payload": {
    "action": "get_progress",
    "data": {
      "include_milestones": true
    }
  }
}
```

#### 4. response（响应）
回复查询消息
```json
{
  "type": "response",
  "payload": {
    "action": "progress_report",
    "data": {
      "current_milestone": "M4",
      "completed": ["M1", "M2", "M3"],
      "blocked": false
    }
  }
}
```

#### 5. notification（通知）
单向通知，无需响应
```json
{
  "type": "notification",
  "payload": {
    "action": "instance_started",
    "data": {
      "agent_name": "Kuroneko-Replica",
      "port": 8092
    }
  }
}
```

## 通信流程

### 发送消息

1. **生成消息**：创建消息 JSON，填充所有必需字段
2. **写入收件箱**：将消息写入目标实例的 inbox 目录
   - 文件名：`msg-<timestamp>-<random>.json`
   - 例如：`inbox-replica/msg-1736242800000-abc123.json`
3. **备份到发件箱**：复制一份到自己的 outbox（可选）
4. **等待确认**（如果 requires_ack=true）

### 接收消息

1. **轮询收件箱**：定期扫描 inbox 目录
2. **读取消息**：读取新消息 JSON 文件
3. **处理消息**：根据 type 和 payload.action 执行相应逻辑
4. **发送确认**（如果 requires_ack=true）
   - 创建 ACK 消息，写入发送方的 inbox
   - 在 ack_deadline 前完成
5. **归档消息**：移动到 processed 子目录或删除

### 消息确认（ACK）

确认消息格式：
```json
{
  "id": "ack-msg-1736242800000-abc123",
  "from": "replica",
  "to": "kuroneko",
  "timestamp": "2026-03-07T16:40:05.000Z",
  "type": "ack",
  "ack_for": "msg-1736242800000-abc123",
  "status": "accepted | rejected | error",
  "message": "指令已接受并开始执行"
}
```

## 使用示例

### 示例 1：主实例请求副本报告进度

```bash
# 1. Kuroneko 创建查询消息
cat > /Users/user/Documents/openKuroneko/.instance-messaging/inbox-replica/msg-$(date +%s)-001.json <<'EOF'
{
  "id": "msg-1736242800000-001",
  "from": "kuroneko",
  "to": "replica",
  "timestamp": "2026-03-07T16:40:00.000Z",
  "type": "query",
  "priority": "normal",
  "requires_ack": true,
  "ack_deadline": "2026-03-07T16:41:00.000Z",
  "payload": {
    "action": "get_progress",
    "data": {}
  }
}
EOF

# 2. Replica 读取并处理（自动或手动）
# 3. Replica 回复进度报告
# 4. Kuroneko 接收 ACK 和响应
```

### 示例 2：实例状态广播

```bash
# Kuroneko 广播完成状态
cat > /Users/user/Documents/openKuroneko/.instance-messaging/inbox-replica/notification-$(date +%s).json <<'EOF'
{
  "id": "notif-1736242800000-abc",
  "from": "kuroneko",
  "to": "replica",
  "timestamp": "2026-03-07T16:40:00.000Z",
  "type": "notification",
  "priority": "low",
  "requires_ack": false,
  "payload": {
    "action": "milestone_completed",
    "data": {
      "milestone": "M3",
      "summary": "已完成副本创建和隔离验证"
    }
  }
}
EOF
```

## 最佳实践

1. **消息幂等性**：同一消息 ID 重复处理应产生相同结果
2. **超时处理**：ack_deadline 过期视为消息丢失，应重试
3. **消息清理**：定期清理已处理消息，避免目录膨胀
4. **错误处理**：处理失败时应发送 error 状态的 ACK
5. **优先级队列**：high priority 消息应优先处理

## 集成到 openKuroneko

### Executor 工具集成

可以创建新的 Executor 工具：
- `send_instance_message`：发送消息到其他实例
- `read_instance_messages`：读取本实例的消息队列
- `ack_instance_message`：确认消息

### Attributor 工具集成

可以创建新的归因工具：
- `write_communication_record`：记录通信历史

### 自动化轮询

可以在外脑启动时自动启动消息轮询器，定期检查 inbox 并触发内脑处理。

## 安全考虑

1. **消息验证**：验证消息格式和签名（未来）
2. **访问控制**：限制可发送消息的实例（未来）
3. **消息加密**：敏感数据加密传输（未来）
4. **速率限制**：防止消息洪泛攻击（未来）

## 版本历史

- v1.0 (2026-03-07): 初始版本，基于文件系统的简单消息队列
