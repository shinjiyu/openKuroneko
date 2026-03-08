#!/bin/bash
# send_message.sh - 发送消息到其他实例
set -e

CHANNEL_DIR="/Users/user/Documents/openKuroneko/inter-instance-channel"
QUEUE_DIR="$CHANNEL_DIR/queue"
PROCESSED_DIR="$CHANNEL_DIR/processed"

if [ $# -lt 3 ]; then
    echo "用法: $0 <from_instance> <to_instance> <message_type> [payload]"
    echo "示例: $0 kuroneko-original kuroneko-replica task_request '{\"task\":\"analyze\"}'"
    exit 1
fi

FROM_INSTANCE="$1"
TO_INSTANCE="$2"
MESSAGE_TYPE="$3"
PAYLOAD="${4:-}"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
MSG_ID="msg-$(date +%s)-$RANDOM"

mkdir -p "$QUEUE_DIR" "$PROCESSED_DIR"

# 构造消息
cat > "$QUEUE_DIR/${MSG_ID}.json" << EOF
{
  "id": "$MSG_ID",
  "timestamp": "$TIMESTAMP",
  "from": "$FROM_INSTANCE",
  "to": "$TO_INSTANCE",
  "type": "$MESSAGE_TYPE",
  "payload": $PAYLOAD
}
EOF

echo "✅ 消息已发送到 $TO_INSTANCE"
echo "Message ID: $MSG_ID"
echo "File: $QUEUE_DIR/${MSG_ID}.json"
