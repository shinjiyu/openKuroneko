# send_instance_message — 发送消息到其他实例

发送消息到其他 openKuroneko 实例（如原实例与副本之间通信）。

## 参数

- `to_instance` (必需): 目标实例 ID（如 "kuroneko-replica"）
- `message_type` (必需): 消息类型
- `payload` (必需): JSON 格式的消息内容

## 支持的消息类型

1. **task_request** - 请求其他实例执行任务
   ```json
   {"task": "analyze_logs", "priority": "high"}
   ```

2. **task_assignment** - 分配任务给其他实例
   ```json
   {"task_id": "task-001", "description": "探索源码", "priority": "high"}
   ```

3. **status_report** - 报告状态
   ```json
   {"status": "working", "progress": "50%", "current_task": "analyzing"}
   ```

4. **query** - 查询其他实例信息
   ```json
   {"query_type": "progress", "task_id": "task-001"}
   ```

5. **ack** - 确认接收消息
   ```json
   {"status": "received", "original_msg": "msg-xxx"}
   ```

## 使用示例

```json
{
  "to_instance": "kuroneko-replica",
  "message_type": "task_request",
  "payload": {"task": "analyze_logs", "priority": "high"}
}
```

## 实现方式

使用共享文件系统消息队列：
- 消息写入: `/Users/user/Documents/openKuroneko/inter-instance-channel/queue/`
- 消息格式: JSON 文件，包含 id、timestamp、from、to、type、payload
- 原子操作: 使用 mv 命令确保消息完整性

## 注意事项

- 目标实例必须已注册（使用 register_instance.sh）
- 消息是异步的，不保证立即处理
- 消息处理后会移动到 processed/ 目录
