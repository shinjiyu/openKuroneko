#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT/.chat-server.pid"
LOG_FILE="$ROOT/.chat-server.log"
PORT="${CHAT_PORT:-3000}"

# ── 检查是否已经在运行 ────────────────────────────────────────────────────────
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[chat] Already running (pid=$OLD_PID). Run ./stop.sh first."
    exit 1
  else
    rm -f "$PID_FILE"
  fi
fi

# ── 检查端口占用 ──────────────────────────────────────────────────────────────
if lsof -ti ":$PORT" > /dev/null 2>&1; then
  echo "[chat] Port $PORT is in use. Killing existing process..."
  lsof -ti ":$PORT" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# ── 后台启动 ──────────────────────────────────────────────────────────────────
echo "[chat] Starting openKuroneko Chat..."
nohup node --env-file="$ROOT/.env" "$ROOT/chat-ui/server.mjs" \
  > "$LOG_FILE" 2>&1 &

PID=$!
echo $PID > "$PID_FILE"

# ── 等待就绪（检测崩溃 + HTTP 可达） ────────────────────────────────────────
for i in $(seq 1 15); do
  sleep 1

  # 进程已退出 → 崩溃
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "[chat] ✗ Server crashed. Last log:"
    tail -20 "$LOG_FILE"
    exit 1
  fi

  # HTTP 可达 → 就绪
  if curl -s "http://localhost:$PORT/" > /dev/null 2>&1; then
    echo "[chat] ✓ Running  pid=$PID"
    echo "[chat] ✓ Open     http://localhost:$PORT"
    echo "[chat] ✓ Logs     tail -f $LOG_FILE"
    exit 0
  fi
done

echo "[chat] ✗ Timeout waiting for server. Check: tail -f $LOG_FILE"
exit 1
