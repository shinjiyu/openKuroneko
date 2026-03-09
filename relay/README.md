# 消息中转服务（Message Relay）

供多 agent 飞书群聊上下文同步：某 agent 在群里发言后，经本服务广播给其它已注册 agent，各端飞书插件将发言插入本机群聊记录。

## 配置

| 环境变量 | 必填 | 说明 |
|----------|------|------|
| `RELAY_KEY` | 是 | 鉴权 key，与各 agent 配置的 `RELAY_KEY` / `--relay-key` 一致 |
| `PORT` | 否 | 监听端口，默认 9090 |

## 运行

```bash
cd relay
npm install
export RELAY_KEY=your-shared-secret
npm run build && npm start
```

或开发模式（改代码自动重启）：

```bash
export RELAY_KEY=your-shared-secret
npm run build && npm run dev
```

## 协议

见项目根目录 `doc/protocols/message-relay.md`。客户端通过 WebSocket 连接，首条发送 `register`（key + agent_id），之后可发送 `speak`；服务器向其它连接广播 `broadcast`。

## 外脑侧配置

飞书接入时同时配置中转 URL 与 key 即启用：

- 环境变量：`RELAY_URL`（如 `ws://localhost:9090`）、`RELAY_KEY`、`RELAY_AGENT_ID`（本 agent 标识，如 `kuroneko`）
- 或 CLI：`--relay-url ws://localhost:9090 --relay-key your-shared-secret --relay-agent-id kuroneko`
