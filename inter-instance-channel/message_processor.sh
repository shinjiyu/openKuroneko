#!/bin/bash
# message_processor.sh - 自动处理接收到的消息（简单版本）

set -e

CHANNEL_DIR="/Users/user/Documents/openKuroneko/inter-instance-channel"
QUEUE_DIR="$CHANNEL_DIR/queue"
PROCESSED_DIR="$CHANNEL_DIR/processed"

if [ $# -lt 1 ]; then
    echo "用法: $0 <instance_id> [--auto-reply]"
    echo "示例: $0 kuroneko-original --auto-reply"
    exit 1
fi

INSTANCE_ID="$1"
AUTO_REPLY="${2:-}"

# 接收所有发给该实例的消息
MESSAGES=$(find "$QUEUE_DIR" -name "*.json" -type f 2>/dev/null | head -20)

if [ -z "$MESSAGES" ]; then
    echo "📭 没有待处理消息"
    exit 0
fi

PROCESSED=0
for MSG_FILE in $MESSAGES; do
    # 检查消息是否发给当前实例
    TO_INSTANCE=$(cat "$MSG_FILE" | grep -o '"to": *"[^"]*"' | cut -d'"' -f4)
    
    if [ "$TO_INSTANCE" = "$INSTANCE_ID" ]; then
        MSG_ID=$(basename "$MSG_FILE" .json)
        FROM=$(cat "$MSG_FILE" | grep -o '"from": *"[^"]*"' | cut -d'"' -f4)
        TYPE=$(cat "$MSG_FILE" | grep -o '"type": *"[^"]*"' | cut -d'"' -f4)
        TIMESTAMP=$(cat "$MSG_FILE" | grep -o '"timestamp": *"[^"]*"' | cut -d'"' -f4)
        
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "📨 处理消息: $MSG_ID"
        echo "   来自: $FROM"
        echo "   类型: $TYPE"
        echo "   时间: $TIMESTAMP"
        echo "   内容:"
        cat "$MSG_FILE" | sed 's/^/   /'
        echo ""
        
        # 移动到已处理目录
        mv "$MSG_FILE" "$PROCESSED_DIR/"
        PROCESSED=$((PROCESSED + 1))
        
        # 自动回复（如果启用）
        if [ "$AUTO_REPLY" = "--auto-reply" ]; then
            REPLY_TYPE="ack"
            REPLY_PAYLOAD='{"status":"received","original_msg":"'"$MSG_ID"'"}'
            
            REPLY_MSG_ID="msg-$(date +%s)-$RANDOM"
            TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
            
            cat > "$QUEUE_DIR/${REPLY_MSG_ID}.json" << EOFREPLY
{
  "id": "$REPLY_MSG_ID",
  "timestamp": "$TIMESTAMP",
  "from": "$INSTANCE_ID",
  "to": "$FROM",
  "type": "$REPLY_TYPE",
  "payload": $REPLY_PAYLOAD
}
EOFREPLY
            
            echo "   ✅ 已自动回复: $REPLY_MSG_ID"
        fi
    fi
done

if [ $PROCESSED -eq 0 ]; then
    echo "📭 没有发给 $INSTANCE_ID 的消息"
else
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ 已处理 $PROCESSED 条消息"
fi
