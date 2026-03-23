# 自演化（Self-Evolution）协议

**版本**：1.0  
**日期**：2026-03-05  

---

## 1. 名称与目的

在 **Git 仓库根目录** 下，为「内脑 / 人类 / CI」提供**可串行、可回滚**的代码变更事务：

- **begin**：记录基准提交；可选在脏工作区时自动 `stash`。
- **verify**：运行约定命令（默认 `npm run build`），**不改变** Git 状态机状态（仅产生通过/失败）。
- **commit**：将当前变更提交为一次 Git commit，并结束事务。
- **rollback**：`git reset --hard` 到基准提交，并尝试 `stash pop`（若 begin 时曾 stash）。

回滚语义以 **Git 对象（commit SHA）** 为准，不依赖历史 `git diff` 文件的反向应用。

---

## 2. 参与方

| 角色 | 约束 |
|------|------|
| **生产者** | `kuroneko-evolve` CLI、未来内脑工具（调用同一 `EvolutionGate` API） |
| **消费者** | Git 工作区、npm/测试脚本 |
| **互斥** | 同一 `repoRoot` 同时仅允许**一个**进行中的事务（文件锁） |

---

## 3. 数据格式

### 3.1 目录布局（位于 `<repoRoot>/.self-evolution/`）

| 路径 | 说明 |
|------|------|
| `state.json` | 当前状态机快照（JSON，UTF-8） |
| `lock` | 单事务锁：内容为持有进程 PID（文本） |
| `logs/YYYY-MM-DD.jsonl` | 结构化日志（Logger 模块，与全局日志 schema 一致） |

### 3.2 `state.json`（version 1）

```json
{
  "version": 1,
  "status": "idle | changing",
  "base_sha": null,
  "stashed": false,
  "started_at": null
}
```

- **`idle`**：`base_sha`、`started_at` 为 `null`，`stashed` 为 `false`。
- **`changing`**：`base_sha` 为 begin 时 `git rev-parse HEAD`；`stashed` 表示 begin 时是否执行了 `git stash push -u`；`started_at` 为 ISO8601。

### 3.3 锁文件 `lock`

- 单行 ASCII 数字：当前持有锁的 PID。
- **Stale 锁**：若 PID 不存在，下一调用方可删除 `lock` 后获取锁。
- **同进程重入**：若锁内 PID 等于当前进程，视为已持有，直接成功（便于单进程内多次调用 `tryAcquireLock`）。

---

## 4. 语义约定

### 4.1 begin

1. 若 `state.status` 已为 `changing` → **拒绝**（须先 `rollback` 或 `commit`）。
2. **短暂获取锁**（与并发 `begin` 互斥）；校验目录为 Git 仓库（`git rev-parse --git-dir`）。
3. 记录 `base_sha = HEAD`。
4. 若工作区脏：
   - `allowDirty=false`（默认）→ **失败**，释放锁。
   - `allowDirty=true` → `git stash push -u -m "openkuroneko-evolution-begin-<ISO8601>"`，`stashed=true`。
5. 写入 `state.json`：`status=changing`，然后**释放锁**（允许多进程 CLI：`begin` 与后续 `commit` 为不同进程；事务边界由 `state.json` 表达）。

### 4.2 verify

- 在 `repoRoot` 下执行配置命令（默认 `npm run build`），超时可选（CLI 默认 10 分钟）。
- **不修改** `state.json`（可与 `changing` 或 `idle` 调用；推荐仅在 `changing` 下使用）。

### 4.3 commit

1. 获取锁；仅当 `status=changing`，否则拒绝并释放锁。
2. `git add -A` + `git commit -m "<message>"`（需已配置 `user.name` / `user.email`）。
3. 成功则重置为 `idle` 并释放锁；失败则锁仍持有，由调用方 `rollback` 或修复后重试。

### 4.4 rollback

1. 获取锁；仅当 `status=changing`，否则拒绝并释放锁。
2. `git reset --hard <base_sha>`。
3. 若 `stashed`：`git stash pop`；若冲突或失败 → **warn 日志**，不自动恢复（需人工处理 stash）。
4. 重置 `idle`、释放锁。

---

## 5. 错误行为

| 情况 | 行为 |
|------|------|
| 非 Git 仓库 | begin 失败，不写 changing |
| 脏工作区且未 `allow-dirty` | begin 失败 |
| 无进行中事务时 commit/rollback | 失败 |
| verify 命令非零退出码 | 返回失败；不自动 rollback |
| commit 无变更可提交 | git commit 失败；状态仍为 changing |

---

## 6. 安全说明

- `verify` 的命令字符串**仅应由受信方传入**（CLI 操作员或硬编码工具）；禁止将任意用户聊天内容直接拼进 shell。
- 本协议**不**执行 `tar -C /` 或系统根目录写操作。

---

## 7. 与内脑工具的关系（后续）

内脑可暴露 `evolution_begin` / `evolution_verify` / `evolution_commit` / `evolution_rollback`，参数映射本协议；实现须调用 `src/evolution` 中 `EvolutionGate`，并写入 `module: evolution` 的 Logger 事件。
