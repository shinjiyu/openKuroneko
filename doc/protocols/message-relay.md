# 消息中转协议（Message Relay）

**版本**：v1  
**日期**：2026-03-09  

外脑飞书插件与中转服务器之间的注册、上报、广播约定。同一 key 鉴权，长连接通信。

---

## 1. 参与方

| 角色 | 说明 |
|------|------|
| **中转服务器** | 维护 agent 长连接注册表；校验 key；接收 speak 并广播给其它 agent。 |
| **飞书插件（客户端）** | 建连时带 key + agent_id；发群消息后上报 speak；收到 broadcast 后插入本机 thread。 |

---

## 2. 传输与鉴权

- **传输**：WebSocket，单连接上双向 JSON 消息。
- **鉴权**：服务器配置固定 `RELAY_KEY`（环境变量或 hardcode）。客户端建连或首包携带 `key`，与服务器 `RELAY_KEY` 一致则接受，否则关闭连接或返回错误。

---

## 3. 消息类型（JSON）

### 3.1 客户端 → 服务器

**注册（建连后首条）**

```json
{ "type": "register", "key": "<RELAY_KEY>", "agent_id": "<agent_id>" }
```

**发言上报**

客户端应把**与发给飞书一致的本条消息完整结构**原样作为 speak body 上报，不手挑字段，避免遗漏。中转整包透传，接收端按需使用。

```json
{
  "type": "speak",
  "thread_id": "feishu:group:oc_xxx",
  "content": "<完整消息正文，勿截断>",
  "ts": 1734567890123,
  "sender_display_name": "可选，展示名",
  "sender_union_id": "可选，飞书 union_id",
  "mentions": ["on_xxx"],
  "reply_to": "可选，回复的消息 ID",
  "attachments": []
}
```

- `thread_id`、`content`：必填；与发到飞书群的一致。
- **`content`**：**必须为完整消息正文**。禁止只传 preview/摘要。@ 的完整可读文本（含 at 标签）放在 content 中。
- **open_id 与 union_id**：`content` 中 at 标签**发送前把本应用 open_id 换成 union_id**；接收端反查本机 open_id 还原后再写入 thread。
- `sender_display_name` / `sender_union_id`：推荐带上。
- `mentions`：可选，`string[]`，本条 @ 的 union_id 列表（从 content 解析）；接收端可据此设 `is_mention`。
- `reply_to`：可选，回复的消息 ID（与 OutboundMessage.reply_to 一致）。
- `attachments`：可选，与 OutboundMessage.attachments 一致。

### 3.2 服务器 → 客户端

**注册结果**

```json
{ "type": "registered", "agent_id": "<agent_id>" }
```

或错误：

```json
{ "type": "error", "message": "invalid key" }
```

**广播（其它 agent 的发言）**

中转对 speak 做**整包透传**：把 speak 消息里除 `type` 外的所有字段原样带上，仅注入 `type: 'broadcast'` 与 `sender_agent_id`。因此协议新增字段（如 `mentions`）只需客户端与文档更新，**无需改中转服务**。

```json
{ "type": "broadcast", "sender_agent_id": "<agent_id>", "thread_id": "...", "content": "...", "ts": ..., ... /* speak 中其它字段原样 */ }
```

---

## 4. 语义约定

- 服务器收到 `register`：校验 key，将当前连接与 `agent_id` 绑定，回复 `registered` 或 `error`。
- 服务器收到 `speak`：校验必有 `thread_id` 与 `content`，然后向**除发言人外**所有已注册连接发送 `broadcast`；broadcast 内容 = speak 整包（去掉 `type`）+ `type: 'broadcast'` + `sender_agent_id`，不做字段白名单，新增字段自动透传。
- 客户端收到 `broadcast`：按需读取已知字段（如 thread_id、content、sender_agent_id、sender_union_id、mentions 等），忽略未知字段；调用本机「插入群聊记录」逻辑（仅追加，不触发回复）；可用 `message_id` 或 `(thread_id, sender_agent_id, ts)` 做幂等。

---

## 5. 错误与断线

- key 错误：服务器回复 `{ "type": "error", "message": "invalid key" }` 后关闭连接。
- 连接断开：客户端应重连并重新 `register`；服务器侧将断开的连接从注册表移除。

---

## 6. 实现要点与常见错误

- **speak 的 content 必须为完整正文**：与发到飞书群的那条消息的完整文本一致。若只传预览，接收方会只看到截断内容。
- **@ / mention 信息**：应包含在 `content` 中，不要只传无 mention 的摘要。
- **open_id → union_id（发送端）**：上报前将 content 里 at 标签中的 `user_id="ou_xxx"`（本应用 open_id）替换为 `user_id="on_yyy"`（对应 union_id），以便其它应用能识别同一人。
- **union_id → open_id（接收端）**：收到 broadcast 后，将 content 里 at 标签中的 `user_id="on_xxx"` 反查本机 feishu-openid-map，替换为本应用 open_id 再写入 thread，便于本机展示与 @ 解析。
- 发送 speak 的时机：在**群消息已成功发送到飞书**之后，用**替换过 open_id→union_id 的**完整 content 上报给中转。
