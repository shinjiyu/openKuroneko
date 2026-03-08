# 自我复制快速参考

> 完整设计见：[self-replication-design.md](./self-replication-design.md)

## 核心原理

```
agent_id = SHA256(MAC + workDir).slice(0,16)
```

不同工作目录 → 不同 agent_id → 天然隔离

## 一键复制命令

```bash
# 1. 创建快照（安全网）
tar -czf /tmp/kuroneko-backup-$(date +%Y%m%d-%H%M%S).tar.gz \
  chat-agent/.brain/ ob-agent/

# 2. 复制目录
cp -r chat-agent chat-agent-copy
cp -r ob-agent ob-agent-copy

# 3. 清理 PID 和状态（让副本从干净状态启动）
rm -f ob-agent-copy/inner-brain.pid
echo '{"mode":"DECOMPOSE","replanCount":0,"replanReason":null,"blockedReason":null}' \
  > chat-agent-copy/.brain/controller-state.json

# 4. 启动副本（不同端口）
cd /Users/user/Documents/openKuroneko
INNER_DIR="$PWD/chat-agent-copy" \
OB_DIR="$PWD/ob-agent-copy" \
WEBCHAT_PORT=8092 \
npx tsx src/cli/outer-brain.ts \
  --dir "$PWD/ob-agent-copy" \
  --inner-dir "$PWD/chat-agent-copy" \
  --webchat-port 8092 \
  --no-cli
```

## 回滚命令

```bash
# 快速回滚：删除副本
rm -rf chat-agent-copy ob-agent-copy

# 完整回滚：从快照恢复
tar -xzf /tmp/kuroneko-backup-YYYYMMDD-HHMMSS.tar.gz
```

## 验证检查

```bash
# 检查原实例状态
cat chat-agent/.brain/controller-state.json
cat ob-agent/inner-brain.pid

# 检查副本实例状态
cat chat-agent-copy/.brain/controller-state.json
cat ob-agent-copy/inner-brain.pid

# 确认两个实例同时运行
ps aux | grep kuroneko
```

## 风险提示

| 风险 | 缓解措施 |
|------|----------|
| 原实例被影响 | 只读操作，不修改原目录 |
| 副本启动失败 | 回滚命令一键删除 |
| 资源竞争 | 不同端口，不同 agent_id |
| 状态污染 | 副本使用干净的 controller-state |

## 实例间通信（预告）

- **方案 1**：文件系统（在共享目录读写约定文件）
- **方案 2**：HTTP（通过 WebChat 端口互相调用）
- **方案 3**：父进程代理（run_agent 工具）

详见 M4 里程碑。
