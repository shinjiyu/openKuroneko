#!/bin/bash

ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT/.chat-server.pid"

# ── Kill server process ───────────────────────────────────────────────────────
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    # Kill entire process group (server + agent child)
    kill -- -"$PID" 2>/dev/null || kill "$PID" 2>/dev/null
    echo "[chat] ✓ Stopped server (pid=$PID)"
  else
    echo "[chat] Server was not running (pid=$PID)."
  fi
  rm -f "$PID_FILE"
else
  echo "[chat] Not running (no pid file)."
fi

# ── Kill any stale agent processes ───────────────────────────────────────────
STALE=$(pgrep -f "dist/cli/index.js.*chat-agent" 2>/dev/null)
if [ -n "$STALE" ]; then
  echo "$STALE" | xargs kill 2>/dev/null
  echo "[chat] ✓ Killed stale agent process(es): $STALE"
fi

# ── Remove stale lock files ───────────────────────────────────────────────────
LOCK_DIR="${OPENKURONEKO_TMP:-/tmp/openkuroneko}"
for lock in "$LOCK_DIR"/*.lock; do
  [ -f "$lock" ] || continue
  LOCK_PID=$(cat "$lock" 2>/dev/null)
  if [ -n "$LOCK_PID" ] && ! kill -0 "$LOCK_PID" 2>/dev/null; then
    rm -f "$lock"
    echo "[chat] ✓ Removed stale lock: $lock (pid=$LOCK_PID)"
  fi
done
