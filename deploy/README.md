# 部署说明（kuroneko.chat）

部署目录：服务器 `/opt/kuroneko`。不修改现有 nginx 其它 server、不占用已用端口。

## 端口

- WebChat: 8091（仅本机；nginx 反代后对外 80/443）
- 消息中转 relay: 9090（仅本机，供多 agent 用）

## 首次部署（在本地执行）

1. 确保可 SSH 登录服务器（建议配置 key，避免密码在历史中）：
   ```bash
   ssh root@43.156.244.45 "mkdir -p /opt/kuroneko"
   ```

2. 同步代码（排除 node_modules、.env、ob-agent 数据）：
   ```bash
   rsync -avz --delete \
     --exclude node_modules --exclude .env --exclude 'ob-agent/threads' --exclude 'ob-agent/users.json' \
     --exclude relay/node_modules --exclude relay/dist \
     -e "ssh -o StrictHostKeyChecking=no" \
     ./ root@43.156.244.45:/opt/kuroneko/
   ```

3. 在服务器上安装依赖、构建、配置环境并启动：
   ```bash
   ssh root@43.156.244.45
   cd /opt/kuroneko
   npm ci && npm run build
   cd relay && npm ci && npm run build && cd ..
   # 创建 .env（复制 .env.example 并填入 FEISHU_*、OPENAI_API_KEY、RELAY_KEY 等）
   cp .env.example .env && vi .env
   # 使用 systemd 或直接运行（见下）
   ```

## 环境变量（.env 或 systemd EnvironmentFile）

必填示例：

- `OPENAI_API_KEY`（或项目所用 LLM 配置）
- `FEISHU=1`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`（飞书）
- `RELAY_KEY`、`RELAY_URL=ws://127.0.0.1:9090`、`RELAY_AGENT_ID=kuroneko`（若用中转）

relay 服务单独配置：`/opt/kuroneko/relay/.env` 或 `RELAY_KEY=xxx PORT=9090`。

## systemd 服务（推荐）

见 `deploy/kuroneko-relay.service`、`deploy/kuroneko-ob.service`。安装后：

```bash
sudo cp deploy/kuroneko-relay.service deploy/kuroneko-ob.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kuroneko-relay kuroneko-ob
```

## nginx（仅新增 kuroneko.chat）

见 `deploy/nginx-kuroneko.chat.conf`。仅新增一个 server，不修改现有配置：

```bash
sudo cp deploy/nginx-kuroneko.chat.conf /etc/nginx/conf.d/kuroneko.chat.conf
sudo nginx -t && sudo systemctl reload nginx
```
