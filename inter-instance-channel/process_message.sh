#!/bin/bash
# process_message.sh - 处理并移动消息到已处理队列
set -e

CHANNEL_DIR="/Users/user/Documents/openKuroneko/inter-instance-channel"
QUEUE_DIR="$CHANNEL_DIR/queue"
PROCESSED_DIR="$CHANNEL_DIR/processed"

if [ $# -lt 1 ]; then
    echo "用法: $0 <message_id>"
    echo "示例: $0 msg-1772901888-12370"
    exit 1
fi

MSG_ID="$1"
MSG_FILE="$QUEUE_DIR/${MSG_ID}.json"

if [ ! -f "$MSG_FILE" ]; then
    echo "❌ 消息不存在: $MSG_ID"
    exit 1
fi

# 移动到已处理队列
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PROCESSED_NAME="${MSG_ID}_${TIMESTAMP}.json"
mv "$MSG_FILE" "$PROCESSED_DIR/$PROCESSED_NAME"

echo "✅ 消息已处理并归档"
echo "   From: $MSG_FILE"
echo "   To: $PROCESSED_DIR/$PROCESSED_NAME"
