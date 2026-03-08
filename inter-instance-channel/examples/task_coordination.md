# 实例间任务协调示例

## 场景：原实例向副本分配探索任务

### 1. 原实例发送任务分配消息

```bash
cd /Users/user/Documents/openKuroneko/inter-instance-channel

./send_message.sh kuroneko-original kuroneko-replica task_assignment '{
  "task_id": "explore-001",
  "description": "探索 src/outer-brain/ 目录结构",
  "priority": "high",
  "deadline": "2026-03-07T17:00:00Z"
}'
```

### 2. 副本接收并处理消息

```bash
# 接收消息
./receive_messages.sh kuroneko-replica

# 处理消息（带自动回复）
./message_processor.sh kuroneko-replica --auto-reply
```

### 3. 副本执行任务并报告进度

```bash
# 发送进度更新
./send_message.sh kuroneko-replica kuroneko-original progress_report '{
  "task_id": "explore-001",
  "status": "in_progress",
  "progress": "30%",
  "findings": "发现 outer-brain 包含 conversation-loop, push-loop 等模块"
}'
```

### 4. 原实例确认进度

```bash
./message_processor.sh kuroneko-original
```

## 消息类型定义

### task_assignment（任务分配）
- from: 分配者实例 ID
- to: 执行者实例 ID
- payload: { task_id, description, priority, deadline }

### progress_report（进度报告）
- from: 执行者实例 ID
- to: 分配者实例 ID
- payload: { task_id, status, progress, findings }

### status_query（状态查询）
- from: 查询者实例 ID
- to: 被查询者实例 ID
- payload: { query_type: "status" | "tasks" | "resources" }

### ack（确认）
- from: 接收者实例 ID
- to: 发送者实例 ID
- payload: { status: "received", original_msg }

## 最佳实践

1. **任务 ID 规范**: 使用 `<type>-<timestamp>-<seq>` 格式
2. **优先级**: critical > high > medium > low
3. **超时处理**: 发送消息后等待 ack，超时未收到则重试
4. **幂等性**: 同一 task_id 的任务可重复处理
5. **状态同步**: 定期发送心跳更新（每 30 秒）

