#!/bin/bash
# 在远端服务器上执行：克隆/更新 openKuroneko、构建 relay、安装 systemd 与 .env
set -e
REPO_URL="${REPO_URL:-https://github.com/shinjiyu/openKuroneko.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/kuroneko}"

mkdir -p "$INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR" && git fetch origin && git reset --hard origin/master && cd -
else
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR/relay"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev
npm run build

# .env：若不存在则生成 RELAY_KEY 并创建
if [ ! -s "$INSTALL_DIR/relay/.env" ]; then
  KEY=$(openssl rand -hex 32)
  echo "RELAY_KEY=$KEY" > "$INSTALL_DIR/relay/.env"
  echo "PORT=9090" >> "$INSTALL_DIR/relay/.env"
  chmod 600 "$INSTALL_DIR/relay/.env"
  echo "Created $INSTALL_DIR/relay/.env with new RELAY_KEY. Save this key for agent config: $KEY"
fi

# systemd
cat > /etc/systemd/system/openkuroneko-relay.service << 'SVC'
[Unit]
Description=openKuroneko Message Relay
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/kuroneko/relay
EnvironmentFile=/opt/kuroneko/relay/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SVC
sed -i "s|/opt/kuroneko|$INSTALL_DIR|g" /etc/systemd/system/openkuroneko-relay.service

systemctl daemon-reload
systemctl enable openkuroneko-relay
systemctl restart openkuroneko-relay
systemctl status openkuroneko-relay --no-pager || true
echo "Relay installed at $INSTALL_DIR/relay, listening on PORT from .env (default 9090)."
