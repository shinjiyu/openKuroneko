# openKuroneko 自我复制方案设计

> 版本：1.0 | 日期：2026-03-07 | 状态：设计完成

## 1. 设计目标

在**不影响当前实例**的前提下，创建一个可独立运行的实例副本，并确保所有操作**可追溯、可回滚**。

## 2. 核心约束分析

### 2.1 路径排他锁机制
```
agent_id = SHA256(MAC + absolutePath).slice(0,16)
```
- **约束**：同一路径只能运行一个 agent 实例（acquirePathLock 机制）
- **推论**：副本必须使用不同的工作目录

### 2.2 双脑进程架构
```
外脑 (kuroneko-ob) → InnerBrainManager → 内脑 (kuroneko)
```
- **外脑**：用户交互层，管理内脑进程生命周期
- **内脑**：目标执行层，通过 .brain/ 文件系统持久化状态
- **推论**：完整复制需要同时考虑内外脑的隔离

### 2.3 BrainFS 文件系统
```
.brain/
├── goal.md              # 战略目标（外脑写）
├── milestones.md        # 战术里程碑（Decomposer 写）
├── constraints.md       # 归因红线（Attributor 追加）
├── knowledge.md         # 环境事实（Attributor 追加）
├── skills.md            # 可复用技能（Attributor 追加）
├── environment.md       # 环境快照（框架更新）
└── controller-state.json # 控制器状态机
```
- **推论**：复制 .brain/ 目录即可复制内脑认知状态

## 3. 复制策略设计

### 3.1 策略选择：目录级隔离

**方案**：创建独立的工作目录副本，保持代码库共享。

```
原实例：
  workDir:    /Users/user/Documents/openKuroneko/chat-agent
  .brain/:    chat-agent/.brain/
  agent_id:   <hash of MAC + chat-agent path>

副本实例：
  workDir:    /Users/user/Documents/openKuroneko/chat-agent-copy
  .brain/:    chat-agent-copy/.brain/
  agent_id:   <hash of MAC + chat-agent-copy path>  ← 不同！
```

**优势**：
1. ✅ 完全隔离（不同 agent_id，无路径锁冲突）
2. ✅ 共享代码（仅复制工作目录，不复制源码）
3. ✅ 状态独立（各自维护 .brain/ 状态）
4. ✅ 易于回滚（删除目录即可）

### 3.2 复制范围

#### 必须复制
- [x] `.brain/` 目录（认知状态）
- [x] `.tool-outputs/` 目录（工具输出，可选）

#### 不需复制
- [ ] `src/` 源码（共享父目录代码）
- [ ] `dist/` 编译产物（共享）
- [ ] `node_modules/`（共享）

#### 外脑配置
- [ ] 外脑工作目录（ob-agent-copy）
- [ ] `soul.md`（人格配置）
- [ ] `inner-brain.pid`（进程 PID 文件）

## 4. 实施步骤

### 4.1 准备阶段（Pre-flight Check）

```bash
# 1. 检查原实例状态
cat chat-agent/.brain/controller-state.json
# 确认 mode 不是 BLOCKED

# 2. 记录当前进程 PID
cat ob-agent/inner-brain.pid

# 3. 创建快照（用于回滚）
tar -czf backup-$(date +%Y%m%d-%H%M%S).tar.gz \
  chat-agent/.brain/ \
  ob-agent/
```

### 4.2 创建副本目录

```bash
# 1. 创建内脑工作目录副本
mkdir -p ../chat-agent-copy
cp -r .brain ../chat-agent-copy/

# 2. 创建外脑工作目录副本
mkdir -p ../ob-agent-copy
cp ../ob-agent/soul.md ../ob-agent-copy/

# 3. 修改副本的 goal（避免目标冲突）
# 编辑 chat-agent-copy/.brain/goal.md
```

### 4.3 启动副本实例

**方式 A：使用独立脚本启动**
```bash
# 启动副本外脑（指向副本内脑目录）
cd /Users/user/Documents/openKuroneko
INNER_DIR=./chat-agent-copy \
OB_DIR=./ob-agent-copy \
npx tsx src/cli/outer-brain.ts \
  --dir ./ob-agent-copy \
  --inner-dir ./chat-agent-copy \
  --no-cli  # 仅通过 WebChat 访问
```

**方式 B：使用 start.sh 变体**
```bash
# 创建 start-copy.sh
INNER_DIR=./chat-agent-copy \
OB_DIR=./ob-agent-copy \
WEBCHAT_PORT=8092 \  # 使用不同端口
./start.sh
```

### 4.4 验证副本运行状态

```bash
# 1. 检查副本内脑 PID
cat ob-agent-copy/inner-brain.pid

# 2. 检查副本 controller 状态
cat chat-agent-copy/.brain/controller-state.json

# 3. 检查副本日志
ls -la /tmp/kuroneko/<new-agent-id>/logs/
```

## 5. 回滚机制设计

### 5.1 快速回滚（紧急情况）

```bash
# 1. 停止副本内脑
kill $(cat ob-agent-copy/inner-brain.pid)

# 2. 停止副本外脑（找到并 kill）
ps aux | grep "outer-brain.*ob-agent-copy"

# 3. 删除副本目录
rm -rf chat-agent-copy ob-agent-copy

# 4. 恢复快照（如需要）
tar -xzf backup-*.tar.gz
```

### 5.2 优雅回滚（保留学习结果）

```bash
# 1. 停止副本进程（同上）

# 2. 归档副本认知状态
mv chat-agent-copy/.brain chat-agent-copy-backup-$(date +%s)

# 3. 提取有价值的学习结果
# 手动审查 knowledge.md / skills.md
# 合并到原实例

# 4. 删除目录
rm -rf chat-agent-copy ob-agent-copy
```

### 5.3 回滚检查清单

- [ ] 副本内脑进程已停止（PID 文件不存在或进程已死）
- [ ] 副本外脑进程已停止
- [ ] 副本工作目录已删除或归档
- [ ] 原实例运行正常（controller-state.json 非 BLOCKED）
- [ ] 原实例 .brain/ 状态未受影响

## 6. 风险评估

### 6.1 已识别风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 路径锁冲突 | 低 | 高 | 使用不同工作目录 |
| 端口冲突 | 中 | 中 | 使用不同 WebChat 端口 |
| 资源竞争 | 中 | 低 | 监控 CPU/内存 |
| Mem0 记忆污染 | 低 | 中 | agent_id 隔离天然防护 |
| 文件系统竞争 | 低 | 高 | 不共享工作目录 |

### 6.2 监控指标

```bash
# CPU 使用
top -pid $(cat ob-agent/inner-brain.pid)

# 内存使用
ps -o rss= -p $(cat ob-agent/inner-brain.pid)

# 磁盘使用
du -sh chat-agent-copy ob-agent-copy
```

## 7. 实例间通信机制（预告）

副本创建后，可通过以下方式通信：
1. **文件系统**：在共享目录写入/读取消息文件
2. **BrainFS 注入**：通过 .brain/input 文件注入指令
3. **工具调用**：使用 run_agent 工具（需验证跨实例能力）

详见 M4 里程碑实施。

## 8. 附录

### A. 目录结构对比

```
openKuroneko/
├── src/                  # 源码（共享）
├── dist/                 # 编译产物（共享）
├── node_modules/         # 依赖（共享）
├── chat-agent/           # 原内脑工作目录
│   ├── .brain/          # 原认知状态
│   └── .tool-outputs/   # 原工具输出
├── chat-agent-copy/      # 副本内脑工作目录
│   ├── .brain/          # 副本认知状态
│   └── .tool-outputs/   # 副本工具输出
├── ob-agent/            # 原外脑工作目录
│   ├── soul.md
│   ├── inner-brain.pid
│   └── threads/
└── ob-agent-copy/       # 副本外脑工作目录
    ├── soul.md
    ├── inner-brain.pid
    └── threads/
```

### B. Agent ID 计算示例

```javascript
// 原实例
const path1 = '/Users/user/Documents/openKuroneko/chat-agent';
const id1 = sha256(mac + path1).slice(0, 16);  // 例如 "a1b2c3d4e5f6g7h8"

// 副本实例
const path2 = '/Users/user/Documents/openKuroneko/chat-agent-copy';
const id2 = sha256(mac + path2).slice(0, 16);  // 例如 "i9j0k1l2m3n4o5p6"
// id1 !== id2 ✓ 天然隔离
```

### C. 快速启动脚本模板

```bash
#!/bin/bash
# start-replica.sh — 启动副本实例

set -e

PROJECT_ROOT="/Users/user/Documents/openKuroneko"
REPLICA_INNER="${PROJECT_ROOT}/chat-agent-copy"
REPLICA_OB="${PROJECT_ROOT}/ob-agent-copy"
WEBCOPY_PORT="${WEBCOPY_PORT:-8092}"

# 检查目录存在
if [ ! -d "$REPLICA_INNER" ]; then
  echo "错误：副本目录不存在：$REPLICA_INNER"
  exit 1
fi

# 启动副本外脑
cd "$PROJECT_ROOT"
INNER_DIR="$REPLICA_INNER" \
OB_DIR="$REPLICA_OB" \
WEBCHAT_PORT="$WEBCOPY_PORT" \
npx tsx src/cli/outer-brain.ts \
  --dir "$REPLICA_OB" \
  --inner-dir "$REPLICA_INNER" \
  --webchat-port "$WEBCOPY_PORT" \
  --no-cli

echo "副本实例已启动：http://localhost:$WEBCOPY_PORT"
```

---

## 设计完成检查清单

- [x] 分析路径排他锁机制（Identity 模块）
- [x] 理解双脑进程架构（InnerBrainManager）
- [x] 明确 BrainFS 文件系统结构
- [x] 设计目录级隔离策略
- [x] 定义复制范围（必须/不需）
- [x] 编写详细实施步骤
- [x] 设计快速/优雅回滚机制
- [x] 评估风险与缓解措施
- [x] 预告实例间通信机制

**下一步**：进入 M3 里程碑，实际创建副本并验证。
