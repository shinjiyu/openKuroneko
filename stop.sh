#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# openKuroneko 停止脚本
#
# 停止顺序：
#   1. 外脑进程（outer-brain.ts / kuroneko-ob）
#   2. 内脑进程（cli/index.ts / kuroneko）—— 优先读 PID 文件，次之 pgrep
#   3. 清理残留锁文件
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OB_DIR="${OB_DIR:-${SCRIPT_DIR}/ob-agent}"
INNER_DIR="${INNER_DIR:-${SCRIPT_DIR}/chat-agent}"
LOCK_DIR="${OPENKURONEKO_TMP:-/tmp/openkuroneko}"

ok()   { echo "  ✓ $*"; }
info() { echo "  · $*"; }
warn() { echo "  ! $*"; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " openKuroneko 停止"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 工具函数：终止一个进程（SIGTERM → 等 3s → SIGKILL）────────────────────────
kill_pid() {
  local label="$1"
  local pid="$2"

  if ! kill -0 "$pid" 2>/dev/null; then
    info "$label (pid=$pid) 已不在运行"
    return
  fi

  kill -TERM "$pid" 2>/dev/null && true
  local waited=0
  while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 30 ]; do
    sleep 0.1
    waited=$((waited + 1))
  done

  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null && true
    ok "$label (pid=$pid) 已强制终止 (SIGKILL)"
  else
    ok "$label (pid=$pid) 已停止"
  fi
}

# ── 1. 外脑进程 ──────────────────────────────────────────────────────────────
echo ""
echo "[外脑]"

OB_PIDS=$(pgrep -f "outer-brain" 2>/dev/null || true)
if [ -n "$OB_PIDS" ]; then
  for pid in $OB_PIDS; do
    kill_pid "外脑" "$pid"
  done
else
  info "外脑未运行"
fi

# ── 2. 内脑进程（PID 文件优先）───────────────────────────────────────────────
echo ""
echo "[内脑]"

INNER_PID_FILE="${OB_DIR}/inner-brain.pid"

if [ -f "$INNER_PID_FILE" ]; then
  INNER_PID=$(cat "$INNER_PID_FILE" 2>/dev/null || true)
  if [ -n "$INNER_PID" ]; then
    kill_pid "内脑" "$INNER_PID"
  fi
  rm -f "$INNER_PID_FILE"
  ok "已删除 inner-brain.pid"
fi

# pgrep 兜底：找所有 kuroneko cli 进程
STALE_INNER=$(pgrep -f "cli/index" 2>/dev/null || true)
if [ -n "$STALE_INNER" ]; then
  for pid in $STALE_INNER; do
    kill_pid "内脑(残留)" "$pid"
  done
else
  info "内脑未运行"
fi

# ── 3. 清理残留锁文件 ──────────────────────────────────────────────────────────
echo ""
echo "[锁文件]"

if [ -d "$LOCK_DIR" ]; then
  cleaned=0
  for lock in "$LOCK_DIR"/*.lock; do
    [ -f "$lock" ] || continue
    LOCK_PID=$(cat "$lock" 2>/dev/null || true)
    if [ -n "$LOCK_PID" ] && ! kill -0 "$LOCK_PID" 2>/dev/null; then
      rm -f "$lock"
      ok "已清理残留锁 $(basename "$lock") (pid=$LOCK_PID)"
      cleaned=$((cleaned + 1))
    fi
  done
  [ "$cleaned" -eq 0 ] && info "无残留锁文件"
else
  info "锁目录不存在：$LOCK_DIR"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " 全部停止完成"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
