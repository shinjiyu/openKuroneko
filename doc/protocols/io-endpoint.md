# I/O Endpoint Protocol

**版本**：v2.0  
**日期**：2026-03-05  
**变更说明**：v2 重新定义了 input/output 的语义，以适配 pi-mono 演化循环架构（见 `doc/protocols/evolutionary-loop.md`）。不再支持「每轮对话回复」式的交互。

---

## 1. 概述

本协议定义 openKuroneko 中 **Input / Output 端点**的接口语义、数据格式与消费约定。

在 pi-mono 演化架构下，input/output 不再是「对话通道」，而是**外脑与内脑之间的干预信号通道**：

- **Input**：外脑向内脑发出的干预信号（策略补充或 BLOCK 响应）
- **Output**：内脑向外脑发出的两类通知（BLOCK 资源请求 / COMPLETE 完成报告）

---

## 2. 参与方

| 角色 | 说明 |
|------|------|
| **外脑（Producer）** | 往 Input 端点写入干预信号的一方（人类用户、父 Agent、调度器） |
| **控制器（Consumer）** | 读取 Input 端点内容的一方（pi-mono 控制器） |
| **控制器（Writer）** | 往 Output 端点写入通知的一方（pi-mono 控制器，仅在 BLOCK 或 COMPLETE 时） |
| **外脑（Reader）** | 读取 Output 端点内容的一方（人类用户、父 Agent） |

**约束**：每个端点同一时刻只允许**一个生产者 + 一个消费者**（单写单读）。

---

## 3. Agent 启动参数

pi-mono 演化模式下，启动 Agent 时**必须**指定 Goal：

```
kuroneko --dir <agentPath> --goal <goal_text>
         [--goal-file <path_to_goal_md>]
         [--workspace <workDir>]
         [--loop fast | interval | once]
```

| 参数 | 说明 | 必填 |
|------|------|------|
| `--dir` | Agent 身份目录（决定 agentId） | 是 |
| `--goal` | Goal 文字内容，控制器写入 `.brain/goal.md` | 二选一 |
| `--goal-file` | 指向已有 goal.md 的路径，控制器复制到 `.brain/goal.md` | 二选一 |
| `--workspace` | 工作目录（文件操作范围），默认与 `--dir` 相同 | 否 |

**重要**：

- Goal 在启动时写入 `.brain/goal.md`，**此后不可通过 input 修改**。
- 若 `.brain/goal.md` 已存在（重启续跑场景），且未指定 `--goal` / `--goal-file`，则沿用已有 goal。
- Goal 不存在且未指定 → 控制器拒绝启动，记录 error 日志后退出。

---

## 4. Input 端点语义（v2）

### 4.1 语义定位

Input **不再**是「用户消息」，而是**外脑的干预信号**，用于：

1. **正常运行时**：对当前执行策略的补充说明（如「注意项目使用 ESM 而非 CJS」）
2. **BLOCK 状态时**：外脑响应内脑的资源请求（如「已为你提供 API Key：xxx」）

### 4.2 写入语义（外脑）

- 写入为**追加**（append）：使用换行追加，支持多次写入
- 内容为 UTF-8 纯文本

### 4.3 读取/消费语义（控制器）

- 控制器在每个 tick 开始时读取 input（offset-based 增量读取，只读新内容）
- **正常运行时**收到 input：触发 `REPLAN`，将 input 内容作为 `replanReason` 传给 Decomposer，`.brain/goal.md` **保持不变**
- **BLOCKED 状态时**收到 input：视为「外脑已响应」，将 input 内容作为 `replanReason` 传给 Decomposer，退出 BLOCKED 状态

### 4.4 空值约定

- 无新内容时返回 `null`（不阻塞）
- BLOCKED 状态下无 input → 控制器返回 `hadWork: false`，调度器退避等待

---

## 5. Output 端点语义（v2）

### 5.1 语义定位

Output 仅在两种情况下写入，**不再有每轮对话回复**：

#### 情况 1：BLOCK — 向外脑索要资源

当内脑遇到无法独立解决的障碍时，Attributor 输出 `BLOCK`，控制器写入：

```
[BLOCK] <描述无法继续的原因及需要的资源>
```

示例：
```
[BLOCK] 需要访问 GitHub API 但缺少 Personal Access Token。
请提供具有 repo 权限的 PAT，并通过 input 发送。
```

#### 情况 2：COMPLETE — 目标达成报告

当所有里程碑完成后，控制器写入：

```
[COMPLETE]
目标：<goal.md 中的目标摘要>
完成时间：<ISO 时间戳>

里程碑完成情况：
- [M1] [Completed] <标题>
- [M2] [Completed] <标题>
- ...

关键产出：
<本次任务的主要产出物描述>
```

### 5.2 写入语义（控制器）

- 写入为**覆盖**（overwrite）：每次写入替换上一条输出
- 写入后不等待读取方确认（fire-and-forget）

### 5.3 读取语义（外脑）

- 外脑自行轮询或监听；写入后不保证通知
- 文件型实现：读取者读文件，读后可自行保留

---

## 6. 文件型实现约定

| 属性 | 值 |
|------|-----|
| 存储位置（默认端点） | `<tempDir>/input`、`<tempDir>/output` |
| 文件编码 | UTF-8 |
| Input 读取 | offset-based 增量读取，不 truncate（支持多次追加写入） |
| Output 写入 | `fs.writeFileSync(path, content, 'utf8')` |
| 端点不存在时 | 自动创建（`mkdirSync` recursive） |

---

## 7. 端点标识与多端点

```
endpoint_id ::= [a-zA-Z0-9_-]+
```

默认端点 id 为 `"default"`。Agent 可注册多个端点，每个端点仍遵守单写单读。多端点通过 `id` 区分（如 `in/supervisor`、`out/supervisor`）。

---

## 8. 运行时注册

端点可在启动时通过 CLI/config 指定，也可在运行时通过 `IORegistry.registerInput / registerOutput` 动态注册。注册后不可移除（进程级生命周期）。

---

## 9. 错误行为

| 场景 | 处理 |
|------|------|
| Input 文件不存在 | 视为空输入，返回 `null` |
| Input 文件读取权限不足 | 记录 `error` 日志，返回 `null`，不崩溃 |
| Output 写入失败 | 记录 `error` 日志，控制器继续运行 |
| Goal 未指定且 `.brain/goal.md` 不存在 | 控制器拒绝启动，退出进程 |
