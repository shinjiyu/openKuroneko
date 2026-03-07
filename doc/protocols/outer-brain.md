# 外脑（Outer Brain）协议

**版本**：2.0  
**日期**：2026-03-07  
**变更**：补充内外脑完整交互路径、任务归属与权限模型、directives 消费机制（v1 directives 未被内脑读取为 bug，已修复）

---

## 1. 概述

外脑是独立进程，负责与人类（及未来 IM 系统）的全部交互，通过结构化文件协议与内脑通信。

```
人类 / IM Bot
    ↕  Channel Adapter（飞书/钉钉/微信/CLI/WebChat）
外脑进程（soul.md + per-thread LLM + 受限工具集）
    ↕  input / directives / output / status 文件
内脑进程（BrainFS + 全工具集）
```

---

## 2. 核心概念

### 2.1 Channel
具体的通信渠道实现。每个 Channel 对应一个 `ChannelAdapter`。

| channel_id | 说明 |
|---|---|
| `cli` | 命令行（本地调试） |
| `webchat` | Web 聊天界面 |
| `feishu` | 飞书 Bot |
| `dingtalk` | 钉钉 Bot |
| `wechat` | 企业微信 |
| `telegram` | Telegram Bot |

### 2.2 Thread（对话线程）
路由的基本单元。格式：`<channel>:<type>:<id>`

| 示例 | 含义 |
|---|---|
| `cli:dm:local` | 本地 CLI |
| `webchat:dm:alice` | WebChat Alice 私信 |
| `webchat:group:G001` | WebChat 群 G001 |
| `feishu:dm:alice` | 飞书 Alice 私信 |
| `feishu:group:G001` | 飞书群 G001 |

### 2.3 User（用户身份）
跨 channel 的统一身份。一个 user_id 可绑定多个 channel 账号。

```json
{
  "user_id": "alice",
  "display_name": "Alice",
  "role": "owner",
  "channels": [
    { "channel_id": "feishu",   "raw_id": "alice_feishu_uid", "priority": 1 },
    { "channel_id": "webchat",  "raw_id": "alice",             "priority": 2 }
  ]
}
```

`UserRole` 枚举：`owner | admin | member | agent`

### 2.4 Group Membership
记录哪些用户与 agent 共同在哪些群组：

```json
{
  "thread_id": "webchat:group:G001",
  "members": ["alice", "bob", "agent"],
  "group_name": "项目组",
  "summary": "讨论任务执行方向",
  "summary_updated": "2026-03-07T10:00:00Z"
}
```

---

## 3. 消息格式

### 3.1 InboundMessage（入站）
```typescript
{
  id:          string;    // 消息唯一 ID
  thread_id:   string;    // "webchat:group:G001"
  channel_id:  string;    // "webchat"
  user_id:     string;    // 统一用户 ID（经 resolveUser 映射）
  raw_user_id: string;    // 平台原始用户 ID
  content:     string;    // 文本内容
  is_mention:  boolean;   // 是否 @mention 了 agent
  mentions:    string[];  // 被 @的所有 user_id
  ts:          number;    // Unix ms
}
```

### 3.2 OutboundMessage（出站）
```typescript
{
  thread_id: string;   // 发往哪个 thread
  content:   string;   // 文本内容
}
```

---

## 4. 内外脑通信协议（完整版）

所有通信介质均为 `<innerTempDir>/`（`/tmp/openkuroneko/<agentId>/`）下的普通文件，无 RPC/HTTP。

### 4.1 外脑 → 内脑（4 条路径）

| 文件 / 信号 | 触发方 | 内脑处理时机 | 语义 |
|---|---|---|---|
| `input`（追加写）| `set_goal` | BLOCKED 和 EXECUTE 每 tick 读 | `[NEW_GOAL]` → 归档旧任务、写 goal.md、转 DECOMPOSE；其他内容 → REPLAN |
| `directives`（JSON Lines 追加）| `send_directive` / PushLoop BLOCK 解封 | BLOCKED 和 EXECUTE 每 tick 读后清空 | `constraint`/`requirement` → 注入 constraints.md；BLOCK 解封 directive → 触发解封决策 |
| SIGTERM 信号 | `stop_inner_brain` 工具 | 立即 | 进程退出 |
| 进程 spawn | `set_goal`（内脑未运行时） | — | `InnerBrainManager.launch()` 拉起内脑进程 |

**`input` 文件格式（新任务）：**
```
[NEW_GOAL]
origin_user: bob

# 任务描述（Markdown）...
```

**`directives` 文件格式（JSON Lines，每行一条）：**
```json
{"ts":"2026-03-07T10:00:00Z","type":"constraint","content":"使用无痕模式","from":"alice"}
{"ts":"2026-03-07T10:01:00Z","type":"requirement","content":"额外分析粉丝趋势","from":"bob"}
{"ts":"2026-03-07T10:05:00Z","type":"feedback","content":"[BLOCK解封] 用户回复：已登录完成","from":"alice"}
```

`type` 含义：
- `constraint` → 追加到 constraints.md，Executor 下一轮必须遵守
- `requirement` → 追加到 constraints.md，作为补充任务要求
- `feedback` → 仅记录日志（若含 `[BLOCK解封]` 前缀则额外触发解封流程）

### 4.2 内脑 → 外脑（2 条路径）

| 文件 | 内脑写入时机 | 外脑读取方式 | 语义 |
|---|---|---|---|
| `status`（JSON 覆盖写）| 每 tick 开始 | `read_inner_status` 工具 / PushLoop | 状态查询 |
| `output`（追加写）| BLOCK / COMPLETE 时 | PushLoop 每 2 秒轮询（`output.ob.offset` 追踪）| 事件通知 |

**`status` 文件格式：**
```json
{
  "ts": "2026-03-07T10:00:00Z",
  "mode": "EXECUTE",
  "milestone": { "id": "M2", "title": "搜索收集微博信息" },
  "goal_origin_user": "alice",
  "blocked": false,
  "block_reason": null
}
```

**`output` 事件格式（JSON）：**
```json
{"type":"BLOCK","message":"需要微博登录 Cookie","question":"请完成微博登录后回复","target_user":"alice","ts":"..."}
{"type":"COMPLETE","message":"任务完成报告全文...","target_user":"alice","ts":"..."}
{"type":"PROGRESS","message":"正在执行第3步","ts":"..."}
```

### 4.3 BLOCK 完整闭环

```
内脑 Attributor → BLOCK → 写 output (BLOCK JSON, target_user=alice)
    ↓
PushLoop 轮询 output → 解析 BLOCK 事件
    ↓
BlockEscalationManager.waitForResolution()
    → 按 alice 的 channel priority 依次发通知（webchat DM → feishu DM → ...）
    → 等待 alice 从任一已通知 thread 回复（最长 escalationWaitMs，默认 30min）
    ↓
alice 回复 → 写 directives: {"type":"feedback","content":"[BLOCK解封] 用户回复：已完成","from":"alice"}
    ↓
内脑 BLOCKED tick → readAndClearDirectives() → 发现 [BLOCK解封]
    → resolveBlock(LLM): CONTINUE 或 REPLAN
    → 注入 constraints.md + 转为 EXECUTE 或 DECOMPOSE
```

### 4.4 EXECUTE 模式下实时约束注入

```
外脑 LLM 调用 send_directive(type=constraint) → 追加 directives
    ↓
内脑 EXECUTE tick → readAndClearDirectives()
    → constraint/requirement → 追加 constraints.md
    → 下一轮 Executor system prompt 包含新约束
```

### 4.5 文件汇总

```
<innerTempDir>/
  input           ← 外脑追加写；内脑以 input.offset 增量读
  input.offset    ← 内脑维护的读取游标（字节数）
  input.ob.offset ← CLI 频道维护的独立读取游标（与内脑互不干扰）
  directives      ← 外脑追加写；内脑每 tick 读后清空（writeFileSync ''）
  output          ← 内脑追加写；PushLoop 以 output.ob.offset 增量读
  output.ob.offset← PushLoop 维护的读取游标
  status          ← 内脑每 tick 覆盖写；外脑随时可读
```

---

## 5. 任务归属与权限模型

### 5.1 归属记录

内脑 `status` 文件中的 `goal_origin_user` 字段记录当前任务的**发起人**（由 `set_goal` 工具写入），用于：
- BLOCK 升级通知：优先通知任务发起人
- 信息展示：外脑在对话中告知用户"当前任务由 xxx 发起"

### 5.2 访问控制设计

**所有已注册用户均可执行全部工具操作**，包括 `set_goal`、`stop_inner_brain`、`send_directive`。

`owner_users`（在 `soul.md` 中配置）的唯一特殊用途是 **BLOCK 升级兜底**：当任务发起人长时间未响应 BLOCK 通知时，系统会升级通知 owner_users。它不限制操作权限。

### 5.3 `owner_users` 的用途

| 用途 | 说明 |
|---|---|
| BLOCK 升级兜底 | 所有 channel 超时后，通知 owner_users |
| ~~工具权限控制~~ | ~~不用于此~~ |

### 5.4 跨用户操作示例

| 场景 | 结果 |
|---|---|
| Bob 派发新任务 | ✅ 允许，调用 `set_goal`，origin_user=bob |
| Bob 停掉 Alice 发起的任务 | ✅ 允许，调用 `stop_inner_brain`（均为注册用户）|
| Bob 给运行中的任务加约束 | ✅ 允许，调用 `send_directive` |
| 未注册用户发消息 | 无法被 resolveUser 识别，消息不进入外脑处理流 |

---

## 6. 外脑工具集（受限）

| 工具 | 功能 | 可用用户 |
|---|---|---|
| `read_inner_status` | 读取内脑当前状态（mode、milestone、blocked、goal_origin_user）| 所有已注册用户 |
| `set_goal` | 派发新目标（内脑未运行则自动启动）| 所有已注册用户 |
| `stop_inner_brain` | 停止内脑进程（SIGTERM）| 所有已注册用户 |
| `send_directive` | 向内脑发即时指令（约束/需求/反馈）| 所有已注册用户 |
| `search_thread` | 搜索对话历史 | 所有已注册用户 |
| `get_time` | 获取当前时间 | 所有已注册用户 |

**禁止工具**：`shell_exec`、`read_file`、`write_file`、`web_search` 等内脑专属工具。

---

## 7. BLOCK 升级通知梯

```
内脑 BLOCK，target_user="alice"
    ↓
按 alice 的 channel priority 排序：
  Level 0: webchat:dm:alice  (priority=1)  等待 escalationWaitMs（默认 30min）
  Level 1: feishu:dm:alice   (priority=2)  等待 30min
  Level 2: wechat:dm:alice   (priority=3)  等待 30min
  Level 3: owner_users       (priority=∞)  最终兜底
    ↓
任意 level 有效回复 → 解封，记录响应时间用于动态学习
所有 channel 均可继续发送后续指令（不因先解封而丢弃后续回复）
```

动态学习：基于响应时间，每次 BLOCK 解封后更新 channel priority（响应快的优先级提升）。

---

## 8. 群聊主动发言

```
群消息到达
    ↓ 记录 thread 历史（threadStore.appendUser）
是否 @mention？
  是 → 必须响应（直接进入 ConversationLoop）
  否 → ParticipationEngine 决策：
        规则预筛（冷却时间、频率限制）
        通过 → fastLLM 判断 SPEAK/SILENT
        未通过 → 静默（仍记录消息到历史）
```

soul.md 中的 `participation` 配置：
```yaml
participation:
  proactive_level: 2          # 0=沉默 1=谨慎 2=正常 3=活跃
  speak_cooldown_ms: 60000    # 连续发言最小间隔
  max_proactive_per_5min: 3   # 5分钟内最多主动发言次数
```

---

## 9. ChannelAdapter 接口

```typescript
interface ChannelAdapter {
  readonly channel_id: string;
  readonly name: string;

  start(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void>;
  send(msg: OutboundMessage): Promise<void>;
  resolveUser(rawUserId: string, channelId: string): string | null;
  stop(): Promise<void>;
}
```

新接入 IM 平台只需实现此接口并注册到 `ChannelRegistry`。

---

## 10. InnerBrainManager 生命周期

```
set_goal(内脑未运行)
    → 对齐 input.offset 到当前文件末尾（避免读到历史内容）
    → appendFileSync(input, '\n[NEW_GOAL]...\n')
    → InnerBrainManager.launch()  → spawn 内脑进程，写 inner-brain.pid

stop_inner_brain
    → InnerBrainManager.stop()  → SIGTERM → 等待退出 → clearPid

内脑进程崩溃 / 退出
    → exit 回调 → clearPid → child = null
    → 下次 set_goal 检测到未运行 → 自动重启
```
