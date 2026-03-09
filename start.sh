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
#   DINGTALK=1 ./start.sh             # 开启钉钉（需配置下方 DINGTALK_* 变量）
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
# 若存在 dist 则用 node（生产），否则用 tsx（开发）
if [ -f "${SCRIPT_DIR}/dist/cli/index.js" ]; then
  INNER_CMD="${INNER_CMD:-node ${SCRIPT_DIR}/dist/cli/index.js --dir ${INNER_DIR} --loop fast}"
else
  INNER_CMD="${INNER_CMD:-tsx ${SCRIPT_DIR}/src/cli/index.ts --dir ${INNER_DIR} --loop fast}"
fi

# ── WebChat 配置 ──────────────────────────────────────────────────────────────
WEBCHAT_PORT="${WEBCHAT_PORT:-8091}"      # 默认开启 WebChat，端口 8091
AGENT_NAME="${AGENT_NAME:-Kuroneko}"

# ── 飞书配置 ──────────────────────────────────────────────────────────────────
FEISHU="${FEISHU:-}"                      # 留空则不开启飞书频道
FEISHU_APP_ID="${FEISHU_APP_ID:-}"
FEISHU_APP_SECRET="${FEISHU_APP_SECRET:-}"
FEISHU_MODE="${FEISHU_MODE:-websocket}"   # websocket（推荐，无需公网）| webhook（需公网 URL）
FEISHU_VERIFY_TOKEN="${FEISHU_VERIFY_TOKEN:-}"   # webhook 模式必填
FEISHU_ENCRYPT_KEY="${FEISHU_ENCRYPT_KEY:-}"     # webhook 模式可选
FEISHU_PORT="${FEISHU_PORT:-8090}"               # webhook 模式端口
FEISHU_AGENT_OPEN_ID="${FEISHU_AGENT_OPEN_ID:-}"

# ── 消息中转（多 agent 群聊上下文同步）──────────────────────────────────────
# 与 relay 服务同配：RELAY_URL=ws://localhost:9090 RELAY_KEY=xxx RELAY_AGENT_ID=kuroneko
RELAY_URL="${RELAY_URL:-}"
RELAY_KEY="${RELAY_KEY:-}"
RELAY_AGENT_ID="${RELAY_AGENT_ID:-}"

# ── 钉钉配置（Stream 长连接，无需公网 URL）────────────────────────────────────
# 开启方式：DINGTALK=1 DINGTALK_CLIENT_ID=xxx DINGTALK_CLIENT_SECRET=yyy ./start.sh
DINGTALK="${DINGTALK:-}"                           # 留空则不开启钉钉频道
DINGTALK_CLIENT_ID="${DINGTALK_CLIENT_ID:-}"       # 钉钉 AppKey
DINGTALK_CLIENT_SECRET="${DINGTALK_CLIENT_SECRET:-}" # 钉钉 AppSecret

# ── 快速模型配置（群聊参与决策用，无 thinking，降低分类延迟）──────────────────
# 推荐填入无 thinking 的 flash 级模型；留空则回退到主对话模型（慢）
FAST_MODEL="${FAST_MODEL:-glm-4-flash}"

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
    --feishu-app-id     "${FEISHU_APP_ID}"
    --feishu-app-secret "${FEISHU_APP_SECRET}"
    --feishu-mode       "${FEISHU_MODE}"
  )
  # webhook 模式额外参数
  if [ "${FEISHU_MODE}" = "webhook" ]; then
    [ -n "${FEISHU_VERIFY_TOKEN}" ] && OB_ARGS+=(--feishu-verify-token "${FEISHU_VERIFY_TOKEN}")
    [ -n "${FEISHU_ENCRYPT_KEY}"  ] && OB_ARGS+=(--feishu-encrypt-key  "${FEISHU_ENCRYPT_KEY}")
    OB_ARGS+=(--feishu-port "${FEISHU_PORT}")
  fi
  [ -n "${FEISHU_AGENT_OPEN_ID}" ] && OB_ARGS+=(--feishu-agent-open-id "${FEISHU_AGENT_OPEN_ID}")
fi

if [ -n "${DINGTALK}" ] && [ -n "${DINGTALK_CLIENT_ID}" ]; then
  OB_ARGS+=(
    --dingtalk-client-id     "${DINGTALK_CLIENT_ID}"
    --dingtalk-client-secret "${DINGTALK_CLIENT_SECRET}"
  )
fi

if [ -n "${RELAY_URL}" ] && [ -n "${RELAY_KEY}" ] && [ -n "${RELAY_AGENT_ID}" ]; then
  OB_ARGS+=(
    --relay-url     "${RELAY_URL}"
    --relay-key     "${RELAY_KEY}"
    --relay-agent-id "${RELAY_AGENT_ID}"
  )
  echo "[relay] 已从环境加载 RELAY_URL=${RELAY_URL} RELAY_AGENT_ID=${RELAY_AGENT_ID}"
else
  echo "[relay] 未配置（设置 RELAY_URL、RELAY_KEY、RELAY_AGENT_ID 后启用）"
fi

# ── 启动前提示 ────────────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " openKuroneko 外脑启动"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " 外脑目录 : ${OB_DIR}"
echo " 内脑目录 : ${INNER_DIR}"
echo " 内脑命令 : ${INNER_CMD}"
[ -n "${WEBCHAT_PORT}" ] && echo " WebChat  : http://localhost:${WEBCHAT_PORT}"
[ -n "${FEISHU}"       ] && echo " 飞书     : ${FEISHU_MODE} 模式"
[ -n "${DINGTALK}"     ] && echo " 钉钉     : Stream 模式（App: ${DINGTALK_CLIENT_ID}）"
[ -n "${RELAY_URL}"    ] && echo " 消息中转 : ${RELAY_URL} (agent: ${RELAY_AGENT_ID})"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " 内脑在收到第一个任务目标时自动启动，无任务时不运行。"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 构建（确保 dist 与源码一致，避免旧构建导致 logger 等未传入）────────────
(cd "${SCRIPT_DIR}" && npm run build)

# ── 启动外脑 ──────────────────────────────────────────────────────────────────
if [ -f "${SCRIPT_DIR}/dist/cli/outer-brain.js" ]; then
  exec node "${SCRIPT_DIR}/dist/cli/outer-brain.js" "${OB_ARGS[@]}"
else
  exec npx tsx "${SCRIPT_DIR}/src/cli/outer-brain.ts" "${OB_ARGS[@]}"
fi
