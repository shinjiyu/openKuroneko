# 循环里程碑协议（Cyclic Milestone Protocol）

版本：1.0  
状态：已实现

## 1. 参与方

| 角色 | 说明 |
|---|---|
| Decomposer | 生产 milestones.md，可声明 `[cyclic:N]` 标签 |
| Attributor | 评估每轮执行，返回 `CYCLE_DONE` 或 `SUCCESS_AND_NEXT` |
| Controller | 消费 Attributor flag，管理 `SLEEPING` 状态 |
| 外脑 PushLoop | 读取 `status` 文件，感知内脑睡眠并抑制无效轮询 |

---

## 2. 里程碑格式

### 普通里程碑（一次性）

```
[M1] [Active]  Title — Description
```

### 循环里程碑

```
[M1] [Active] [cyclic:86400000]  Title — Description
```

- `[cyclic:N]`：N 为循环间隔（毫秒）。常用值：
  - `3600000`  = 1 小时
  - `86400000` = 24 小时
  - `604800000` = 7 天
- 终止条件由 Attributor 在每轮归因后自主判断：满足 → `SUCCESS_AND_NEXT`；未满足 → `CYCLE_DONE`

---

## 3. 控制标志（ControlFlag）

| Flag | 含义 | 触发时机 |
|---|---|---|
| `CONTINUE` | 本轮有进展，继续执行 | 里程碑未完成，但有实质推进 |
| `SUCCESS_AND_NEXT` | 里程碑完成（含终止条件满足） | 循环目标已达成，或普通里程碑完成 |
| `REPLAN` | 根本性障碍，需重新规划 | 当前方案不可行 |
| `BLOCK` | 需人类介入 | 需要外部资源/授权 |
| `CYCLE_DONE` | 本轮循环工作完成，进入等待 | **仅用于 cyclic 里程碑**，目标未达成，需等下一周期 |

### `CYCLE_DONE` 使用约束

- 只能用于 `[cyclic:N]` 标签的里程碑
- 普通里程碑的 Attributor 不得返回 `CYCLE_DONE`（会被 Controller 降级为 CONTINUE）
- REASON 中必须说明：本轮做了什么 + 下一轮应从哪里继续

---

## 4. Controller 状态机扩展

新增 `SLEEPING` 模式：

```
DECOMPOSE → EXECUTE → ATTRIBUTE ─── CYCLE_DONE ──→ SLEEPING
                                                       │
                                               睡眠时间到达
                                                       │
                                                    EXECUTE（同一个循环里程碑）
```

### `ControllerState` 新增字段

```typescript
sleepUntil?: string | null;  // ISO 8601，SLEEPING 时有效
cycleCount?: number;         // 当前里程碑已完成的循环次数（从0开始）
```

### SLEEPING 模式 tick 行为

1. 检查外脑 input 和 directives（人工干预始终优先）
2. 若 `Date.now() < sleepUntil`：返回 `{hadWork: false}`（调度器退避）
3. 若时间已到：重置 `sleepUntil = null`，`mode = EXECUTE`，返回 `{hadWork: true}`

---

## 5. status 文件协议

`<tempDir>/status` JSON 新增字段：

```json
{
  "ts": "2026-03-08T09:00:00Z",
  "mode": "SLEEPING",
  "sleeping_until": "2026-03-09T09:00:00Z",   // SLEEPING 时出现
  "cycle_count": 3,                             // cyclic 里程碑时出现
  "milestone": { "id": "M1", "title": "每日运营" },
  "goal_origin_user": "bob",
  "blocked": false,
  "block_reason": null
}
```

外脑 PushLoop 读取此文件，当 `mode === "SLEEPING"` 时可降低轮询频率。

---

## 6. 示例：小红书运营任务

**goal.md：**
```
帮我运营小红书账号，涨粉到 100 人。
每天发一篇优质内容，追热点话题，分析数据持续优化。
```

**milestones.md（Decomposer 生成）：**
```
[M1] [Active]  [cyclic:86400000]  每日运营循环 — 追热点、创作内容、发帖、记录数据 | 终止条件：粉丝数 >= 100
[M2] [Pending] 运营总结 — 输出完整运营报告和方法论沉淀
```

**每轮 Attributor 判断：**
```
CONTROL: CYCLE_DONE        （粉丝 < 100，今日内容已发）
  或
CONTROL: SUCCESS_AND_NEXT  （粉丝 >= 100，激活 M2）
```

---

## 7. 错误行为

| 场景 | 处理 |
|---|---|
| 非 cyclic 里程碑返回 `CYCLE_DONE` | Controller 降级为 `CONTINUE`，记录 warn 日志 |
| SLEEPING 时收到外脑 input | 立即唤醒，进入 DECOMPOSE（外脑干预优先） |
| SLEEPING 时收到 `[BLOCK解封]` directive | 立即唤醒，进入 EXECUTE |
| `sleepUntil` 解析失败 | 立即唤醒，记录 warn 日志 |
| cycleCount 超过 1000 | 记录 warn，但不强制停止（由目标决定何时终止） |
