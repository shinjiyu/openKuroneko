#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# openKuroneko 启动脚本
#
# 只启动外脑（Outer Brain）。内脑由外脑在收到第一个 set_goal 指令时自动拉起。
#
# 用法：
#   ./start.sh                        # 使用默认配置
#   WEBCHAT_PORT=8091 ./start.sh      # 开启 WebChat
#   FEISHU=1 ./start.sh               # 开启飞书（需配置下方 FEISHU_* 变量）
#
# 环境变量（可在此处修改，或通过 .env 文件注入）：
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── 目录配置 ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 内脑 agent 目录（存放 .brain/、task 文件等）
INNER_DIR="${INNER_DIR:-${SCRIPT_DIR}/chat-agent}"

# 外脑工作目录（存放 threads/、users.json、soul.md、inner-brain.pid）
OB_DIR="${OB_DIR:-${SCRIPT_DIR}/ob-agent}"

# ── 内脑启动命令（set_goal 时自动拉起）──────────────────────────────────────
# 使用 tsx 直接运行源码（开发环境）
INNER_CMD="${INNER_CMD:-tsx ${SCRIPT_DIR}/src/cli/index.ts --dir ${INNER_DIR} --loop fast}"
# 生产环境改用编译产物：
# INNER_CMD="node ${SCRIPT_DIR}/dist/cli/index.js --dir ${INNER_DIR} --loop fast"

# ── WebChat 配置 ──────────────────────────────────────────────────────────────
WEBCHAT_PORT="${WEBCHAT_PORT:-8091}"      # 默认开启 WebChat，端口 8091
AGENT_NAME="${AGENT_NAME:-Kuroneko}"

# ── 飞书配置 ──────────────────────────────────────────────────────────────────
FEISHU="${FEISHU:-}"                      # 留空则不开启飞书频道
FEISHU_APP_ID="${FEISHU_APP_ID:-}"
FEISHU_APP_SECRET="${FEISHU_APP_SECRET:-}"
FEISHU_VERIFY_TOKEN="${FEISHU_VERIFY_TOKEN:-}"
FEISHU_ENCRYPT_KEY="${FEISHU_ENCRYPT_KEY:-}"
FEISHU_PORT="${FEISHU_PORT:-8090}"
FEISHU_AGENT_OPEN_ID="${FEISHU_AGENT_OPEN_ID:-}"

# ── 快速模型配置（群聊参与决策用，无 thinking，降低分类延迟）──────────────────
# 与主力模型相同但关闭 thinking，兼顾精度与速度
FAST_MODEL="${FAST_MODEL:-glm-5}"

# ── BLOCK 升级配置 ────────────────────────────────────────────────────────────
ESCALATION_WAIT_MS="${ESCALATION_WAIT_MS:-1800000}"   # 默认 30min

# ── 加载 .env（如果存在）─────────────────────────────────────────────────────
if [ -f "${SCRIPT_DIR}/.env" ]; then
  # shellcheck disable=SC1091
  set -a && source "${SCRIPT_DIR}/.env" && set +a
fi

# ── 参数组装 ──────────────────────────────────────────────────────────────────
OB_ARGS=(
  --dir        "${OB_DIR}"
  --inner-dir  "${INNER_DIR}"
  --inner-cmd  "${INNER_CMD}"
  --agent-name "${AGENT_NAME}"
  --escalation-wait-ms "${ESCALATION_WAIT_MS}"
)

[ -n "${FAST_MODEL}" ] && OB_ARGS+=(--fast-model "${FAST_MODEL}")

if [ -n "${WEBCHAT_PORT}" ]; then
  OB_ARGS+=(--webchat-port "${WEBCHAT_PORT}")
fi

if [ -n "${FEISHU}" ] && [ -n "${FEISHU_APP_ID}" ]; then
  OB_ARGS+=(
    --feishu-app-id       "${FEISHU_APP_ID}"
    --feishu-app-secret   "${FEISHU_APP_SECRET}"
    --feishu-verify-token "${FEISHU_VERIFY_TOKEN}"
    --feishu-port         "${FEISHU_PORT}"
  )
  [ -n "${FEISHU_ENCRYPT_KEY}"    ] && OB_ARGS+=(--feishu-encrypt-key    "${FEISHU_ENCRYPT_KEY}")
  [ -n "${FEISHU_AGENT_OPEN_ID}"  ] && OB_ARGS+=(--feishu-agent-open-id  "${FEISHU_AGENT_OPEN_ID}")
fi

# ── 启动前提示 ────────────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " openKuroneko 外脑启动"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " 外脑目录 : ${OB_DIR}"
echo " 内脑目录 : ${INNER_DIR}"
echo " 内脑命令 : ${INNER_CMD}"
[ -n "${WEBCHAT_PORT}" ] && echo " WebChat  : http://localhost:${WEBCHAT_PORT}"
[ -n "${FEISHU}"       ] && echo " 飞书     : Webhook :${FEISHU_PORT}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " 内脑在收到第一个任务目标时自动启动，无任务时不运行。"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 启动外脑 ──────────────────────────────────────────────────────────────────
exec npx tsx "${SCRIPT_DIR}/src/cli/outer-brain.ts" "${OB_ARGS[@]}"
