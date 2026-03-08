#!/bin/bash
# update_heartbeat.sh - 更新实例心跳
set -e

CHANNEL_DIR="/Users/user/Documents/openKuroneko/inter-instance-channel"
INSTANCES_DIR="$CHANNEL_DIR/instances"

if [ $# -lt 1 ]; then
    echo "用法: $0 <instance_id> [status]"
    echo "示例: $0 kuroneko-original active"
    exit 1
fi

INSTANCE_ID="$1"
STATUS="${2:-active}"
STATUS_FILE="$INSTANCES_DIR/$INSTANCE_ID/status.json"

if [ ! -f "$STATUS_FILE" ]; then
    echo "❌ 实例未注册: $INSTANCE_ID"
    exit 1
fi

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 更新心跳时间和状态
cd "$INSTANCES_DIR/$INSTANCE_ID"
cat status.json | jq ".last_heartbeat = \"$TIMESTAMP\" | .status = \"$STATUS\"" > status.json.tmp
mv status.json.tmp status.json

echo "💓 心跳已更新: $INSTANCE_ID @ $TIMESTAMP"
