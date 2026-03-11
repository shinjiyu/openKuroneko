# 中转消息 ID 与身份映射分析

## 场景

- **群聊**：两个机器人（Kuroneko 本机、Blackcat 另一台） + 人类（于振宇等）。
- **飞书限制**：不向机器人推送「其他机器人的普通消息」。
- **中转服务器**：某机器人在群里发言后，向中转上报 `speak`，中转向其他已注册 agent 广播 `broadcast`，其他机器人把广播写入本地 thread 并参与决策。

## 当前数据流

### 1. 本机发群消息后上报（feishu.ts send）

```json
{
  "type": "speak",
  "thread_id": "feishu:group:oc_xxx",
  "content": "...",
  "ts": 123,
  "sender_display_name": "kuroneko",
  "sender_union_id": "on_efa363b520e0656c14a823b813e38094"
}
```

- **不转发 open_id**：open_id 为应用维度，对接收方无意义且易导致 open_id cross app。接收方用本机 feishu-openid-map 按 union_id 解析 open_id 补全结构。

### 2. 中转服务器转发（relay/src/index.ts）

收到 `speak` 后向其他连接广播，**仅转发 union_id + 展示名**：

```json
{
  "type": "broadcast",
  "thread_id": "...",
  "sender_agent_id": "on_efa363b520e0656c14a823b813e38094",
  "content": "...",
  "ts": 123,
  "sender_display_name": "kuroneko",
  "sender_union_id": "on_efa363b520e0656c14a823b813e38094"
}
```

- `sender_agent_id` = 发言者的 relay 注册 id（当前实现里即该机器人的 union_id）。

### 3. 接收方处理（outer-brain relayIngestRef）

- 用 `userId = data.sender_agent_id`（即 on_xxx）规范为 `feishu_on_xxx` 做「发言人」标识。
- 仅用 `sender_union_id` + `sender_name` 注册 UserStore（channels 只填 union_id 为 raw_id）；用 `mergeByUnionId` 更新本机 feishu-openid-map 中已有条目的展示名。
- **补全 open_id**：需要 open_id 时（如发 DM、@），在本机用 `feishuOpenIdMap.getOpenIdForUnionId(sender_union_id)` 从本机数据解析，仅使用本应用下由飞书原生事件写入的 open_id。

## 问题 2：userId 与内部约定不一致

- 内部约定：飞书用户统一用 `feishu_on_<union_id>` 作为 user_id（如 `feishu_on_94626acdda9676a3ff1aee6c9c58bf73`）。
- 广播里 `sender_agent_id` 当前是 `on_xxx`（无 `feishu_` 前缀），若直接用作 register 的 userId 和 append 的 user_id，会导致同一人在「飞书原生事件」与「中转广播」中 id 不一致（一个 feishu_on_xxx，一个 on_xxx），展示与去重容易错乱。

**结论**：收到 broadcast 时，若 `sender_agent_id` 为 `on_xxx`，应规范为 `feishu_on_xxx` 再用于 UserStore 注册与 thread 写入。

## 已采用方案

1. **转发侧**：speak 与 broadcast **均不携带 open_id**，只转发 union_id + 展示名。
2. **中转服务器**：broadcast 不再包含 `sender_open_id` 字段。
3. **接收方**：仅用 `sender_union_id` + `sender_name` 注册与展示；需要 open_id 时在本机用 `getOpenIdForUnionId(union_id)` 从本地映射补全。

## 参考

- 群聊历史：`ob-agent/threads/feishu_group_oc_*.history.jsonl` 中 Blackcat 消息的 user_id 曾为 `on_94626acdda9676a3ff1aee6c9c58bf73`，与 users.json 中 `feishu_on_94626acdda9676a3ff1aee6c9c58bf73` 的约定不一致。
- 飞书 99992361：open_id 与当前应用不匹配时会报「open_id cross app」。
