# 仅部署中转服务 + Token 安全

## 1. 只跑中转、不跑外脑

- 服务器上**只启用** `kuroneko-relay`，**不启用** `kuroneko-ob`。
- Token 仅存在于服务器本地 `relay/.env`，**禁止写入任何代码库或文档**，防止被扫描。

## 2. 在服务器上设置 Token（一次性）

SSH 登录后执行（生成随机 key 并写入仅 root 可读的 .env）：

```bash
RELAY_KEY=$(openssl rand -hex 32)
echo "RELAY_KEY=$RELAY_KEY
PORT=9090" > /opt/kuroneko/relay/.env
chmod 600 /opt/kuroneko/relay/.env
systemctl restart kuroneko-relay
```

**务必保存本次输出的 RELAY_KEY**：各 agent 的 `RELAY_KEY` / `--relay-key` 需与此一致，且只能通过安全渠道（如 1Password / 线下）分享，不要写入 git、issue、聊天记录。

如需查看当前使用的 key（仅服务器上）：

```bash
grep RELAY_KEY /opt/kuroneko/relay/.env
```

## 3. 防扫描要点

- `relay/.env` 已加入 `.gitignore`，不纳入版本控制。
- 文档与示例中不写真实 token，仅写“在服务器 relay/.env 中设置”。
- `chmod 600` 保证仅属主可读，避免被同机其他用户或进程扫描。
- 应用代码不打印、不记录 RELAY_KEY。
