# 实例副本创建与验证报告

> 生成时间: 2026-03-07T16:37:00.000Z

## 1. 执行摘要

✅ **成功创建并启动了独立运行的实例副本**

- **原实例**: ob-agent (端口 8091) + chat-agent (PID 56779)
- **副本实例**: ob-agent-replica (端口 8092) + chat-agent-replica (无内脑PID)
- **隔离性验证**: 两个实例完全隔离，互不影响

---

## 2. 副本创建过程

### 2.1 内脑副本 (chat-agent-replica)

```bash
# 创建内脑工作目录
cp -r chat-agent chat-agent-replica

# 副本内容
.brain/           # 完整复制（包含认知状态）
.tool-outputs/    # 工具输出目录
doc/              # 文档目录
```

**关键状态**:
- ✅ `.brain/controller-state.json` 复制成功
- ✅ 认知状态完整（goal/milestones/constraints/knowledge/skills）
- ⚠️ 内脑尚未启动（PID 文件不存在，符合预期）

### 2.2 外脑副本 (ob-agent-replica)

```bash
# 创建外脑工作目录
cp -r ob-agent ob-agent-replica

# 清理 PID 文件（避免冲突）
rm -f ob-agent-replica/inner-brain.pid

# 副本内容
ob-agent/         # 外脑状态目录（自动创建）
soul.md           # Agent 灵魂定义
threads/          # 会话线程存储
webchat-users.json # WebChat 用户配置
```

**关键操作**:
- ✅ 删除 `inner-brain.pid`（避免 PID 冲突）
- ✅ 保留 `soul.md` 和 `threads/`
- ✅ 保留 `webchat-users.json`

---

## 3. 启动验证

### 3.1 副本外脑启动

```bash
# 启动命令（使用不同端口和目录）
INNER_DIR=/Users/user/Documents/openKuroneko/chat-agent-replica \
OB_DIR=/Users/user/Documents/openKuroneko/ob-agent-replica \
WEBCHAT_PORT=8092 \
AGENT_NAME=Kuroneko-Replica \
npx tsx src/cli/outer-brain.ts \
  --dir ob-agent-replica \
  --inner-dir chat-agent-replica \
  --webchat-port 8092 \
  --agent-name Kuroneko-Replica
```

**启动结果**:
```
[webchat] listening on :8092
```

✅ **外脑启动成功**

### 3.2 进程验证

```bash
# 原实例进程
PID 53762 - 外脑 (端口 8091)
PID 56779 - 内脑 (chat-agent)

# 副本实例进程
PID 92367 - 外脑 (端口 8092)
无内脑PID - 内脑尚未启动（正常，等待第一个任务）
```

✅ **两个实例同时运行，无冲突**

### 3.3 端口验证

```bash
# 原实例
tcp46  *.8091  LISTEN  (PID 53762)

# 副本实例
tcp46  *.8092  LISTEN  (PID 92367)
```

✅ **端口隔离成功，无冲突**

---

## 4. 隔离性验证

### 4.1 目录隔离

| 实例 | 外脑目录 | 内脑目录 | 端口 |
|------|---------|---------|------|
| 原实例 | `ob-agent/` | `chat-agent/` | 8091 |
| 副本实例 | `ob-agent-replica/` | `chat-agent-replica/` | 8092 |

✅ **完全隔离的工作目录**

### 4.2 原实例完整性

```bash
# 原实例 .brain 目录未受影响
chat-agent/.brain/controller-state.json  # 完整
ob-agent/inner-brain.pid                 # 56779 (运行中)
ob-agent/soul.md                         # 完整
ob-agent/threads/                        # 完整
```

✅ **原实例未被修改（遵守红线约束）**

### 4.3 Agent ID 隔离

根据 openKuroneko 的路径锁机制：
- `agent_id = SHA256(MAC + absolutePath).slice(0,16)`
- `chat-agent` → agent_id: `xxxx` (原实例)
- `chat-agent-replica` → agent_id: `yyyy` (副本实例)

✅ **不同的 agent_id，天然隔离**

---

## 5. WebChat 访问验证

### 5.1 原实例 (端口 8091)
- URL: `http://localhost:8091`
- 状态: ✅ 返回 HTML 页面
- Agent Name: Kuroneko

### 5.2 副本实例 (端口 8092)
- URL: `http://localhost:8092`
- 状态: ✅ 返回 HTML 页面
- Agent Name: Kuroneko-Replica

✅ **两个实例均可独立访问**

---

## 6. 认知状态验证

### 6.1 副本内脑状态

```json
{
  "mode": "EXECUTE",
  "replanCount": 0,
  "replanReason": null,
  "blockedReason": null
}
```

✅ **认知状态完整复制**

### 6.2 副本 .brain 目录结构

```
chat-agent-replica/.brain/
├── constraints.md       (1109 bytes)
├── controller-state.json (92 bytes)
├── environment.md       (694 bytes)
├── goal.md              (801 bytes)
├── history/             (8 entries)
├── knowledge.md         (4512 bytes)
├── milestones.md        (471 bytes)
├── skills/              (9 entries)
└── skills.md            (649 bytes)
```

✅ **完整的认知状态副本**

---

## 7. 关键发现

### 7.1 成功要素

1. **路径隔离**: 使用不同的工作目录（`chat-agent-replica` / `ob-agent-replica`）
2. **端口隔离**: 使用不同的 WebChat 端口（8092 vs 8091）
3. **PID 清理**: 删除副本的 `inner-brain.pid` 避免冲突
4. **状态复制**: 完整复制 `.brain/` 目录保持认知连续性
5. **原实例保护**: 严格遵守红线约束，不修改原实例

### 7.2 验证要点

- ✅ 副本外脑成功启动（端口 8092）
- ✅ 原实例继续运行（端口 8091）
- ✅ 两个实例进程共存（无 PID 冲突）
- ✅ 端口隔离（无端口冲突）
- ✅ 目录隔离（不同的工作目录）
- ✅ 认知状态完整（.brain/ 目录完整复制）
- ✅ 原实例未受影响（红线约束遵守）

---

## 8. 后续步骤建议

1. **触发内脑启动**: 通过 WebChat 发送任务给副本实例，触发内脑启动
2. **功能测试**: 验证副本实例的完整功能（目标执行、工具调用等）
3. **资源监控**: 监控两个实例的资源使用（内存、CPU）
4. **清理机制**: 设计副本实例的清理和回收机制

---

## 9. 约束遵守验证

| 约束 | 状态 | 说明 |
|------|------|------|
| 🔴 禁止修改原实例 | ✅ | 原实例 `chat-agent/` 和 `ob-agent/` 未被修改 |
| ⚠️ 清理 PID 文件 | ✅ | 删除 `ob-agent-replica/inner-brain.pid` |
| ⚠️ 使用不同端口 | ✅ | 副本使用 8092，原实例使用 8091 |
| ⚠️ 路径锁机制 | ✅ | 使用不同工作目录产生不同 agent_id |

---

## 10. 结论

✅ **M3 里程碑完成**

成功在隔离环境中创建了可运行的实例副本，并验证了启动状态。两个实例（原实例和副本）可以同时运行，完全隔离，互不影响。所有约束条件均得到满足。

**副本实例访问地址**: `http://localhost:8092`
