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

```json
{ "type": "speak", "thread_id": "feishu:group:oc_xxx", "content": "...", "ts": 1734567890123, "message_id": "optional_id" }
```

- `thread_id`：与飞书 thread_id 一致（`<channel>:<type>:<平台原生ID>`）。
- `message_id`：可选，用于去重。

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

```json
{ "type": "broadcast", "thread_id": "feishu:group:oc_xxx", "sender_agent_id": "<agent_id>", "content": "...", "ts": 1734567890123, "message_id": "optional" }
```

---

## 4. 语义约定

- 服务器收到 `register`：校验 key，将当前连接与 `agent_id` 绑定，回复 `registered` 或 `error`。
- 服务器收到 `speak`：向**除发言人外**所有已注册连接发送 `broadcast`；发言人自己也可不发（或发也可，插件可忽略自己 agent_id 的 broadcast）。
- 客户端收到 `broadcast`：调用本机「插入群聊记录」逻辑（仅追加，不触发回复）；可用 `message_id` 或 `(thread_id, sender_agent_id, ts)` 做幂等。

---

## 5. 错误与断线

- key 错误：服务器回复 `{ "type": "error", "message": "invalid key" }` 后关闭连接。
- 连接断开：客户端应重连并重新 `register`；服务器侧将断开的连接从注册表移除。
