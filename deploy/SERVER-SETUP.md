# kuroneko.chat 服务器已部署说明

**服务器**: 43.156.244.45 (kuroneko.chat)  
**部署路径**: `/opt/kuroneko`  
**未改动**: 现有 nginx 其它站点、其它端口与服务均未修改。

---

## 当前状态

- **relay（消息中转）**: 已启动，监听 127.0.0.1:9090，`RELAY_KEY=kuroneko-relay-secret`
- **外脑（kuroneko-ob）**: 已安装但未启动，需先填写 `.env` 中的密钥
- **nginx**: 已新增 `kuroneko.chat` → 反代到本机 8091（WebChat）

---

## 启动外脑前必做

1. **SSH 登录**  
   ```bash
   ssh root@43.156.244.45
   ```

2. **编辑 `/opt/kuroneko/.env`**，至少填写：
   - `OPENAI_API_KEY=` → 你的 LLM API Key
   - `FEISHU_APP_ID=`、`FEISHU_APP_SECRET=` → 飞书应用凭证（若用飞书）

3. **启动外脑**  
   ```bash
   sudo systemctl start kuroneko-ob
   sudo systemctl status kuroneko-ob
   ```

---

## 常用命令

```bash
# 查看 relay / 外脑状态
sudo systemctl status kuroneko-relay kuroneko-ob

# 重启
sudo systemctl restart kuroneko-relay kuroneko-ob

# 查看外脑日志（journalctl）
journalctl -u kuroneko-ob -f
```

---

## 安全建议

- 将 `RELAY_KEY=kuroneko-relay-secret` 改为自设强密钥，并同步修改 `/opt/kuroneko/relay/.env` 中的 `RELAY_KEY`。
- 确认 kuroneko.chat 的 DNS A 记录指向 43.156.244.45；若需 HTTPS，可在 nginx 为 kuroneko.chat 配置 SSL（如 Let’s Encrypt）。
