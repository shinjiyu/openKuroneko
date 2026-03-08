#!/bin/bash
# receive_messages.sh - 接收并处理消息
set -e

CHANNEL_DIR="/Users/user/Documents/openKuroneko/inter-instance-channel"
QUEUE_DIR="$CHANNEL_DIR/queue"
PROCESSED_DIR="$CHANNEL_DIR/processed"

if [ $# -lt 1 ]; then
    echo "用法: $0 <my_instance> [process|list]"
    echo "示例: $0 kuroneko-replica list"
    echo "示例: $0 kuroneko-replica process"
    exit 1
fi

MY_INSTANCE="$1"
ACTION="${2:-list}"

mkdir -p "$PROCESSED_DIR"

if [ "$ACTION" = "list" ]; then
    # 列出所有发给当前实例的消息
    echo "📬 $MY_INSTANCE 的待处理消息："
    echo "--------------------------------"
    for msg_file in "$QUEUE_DIR"/*.json; do
        [ -f "$msg_file" ] || continue
        TO_INSTANCE=$(cat "$msg_file" | grep -o '"to": *"[^"]*"' | cut -d'"' -f4)
        if [ "$TO_INSTANCE" = "$MY_INSTANCE" ]; then
            MSG_ID=$(basename "$msg_file" .json)
            FROM=$(cat "$msg_file" | grep -o '"from": *"[^"]*"' | cut -d'"' -f4)
            TYPE=$(cat "$msg_file" | grep -o '"type": *"[^"]*"' | cut -d'"' -f4)
            TIMESTAMP=$(cat "$msg_file" | grep -o '"timestamp": *"[^"]*"' | cut -d'"' -f4)
            echo "• [$MSG_ID] $FROM -> $MY_INSTANCE"
            echo "  类型: $TYPE | 时间: $TIMESTAMP"
            echo "  文件: $msg_file"
            echo ""
        fi
    done
elif [ "$ACTION" = "process" ]; then
    # 处理并移动到已处理目录
    echo "⚙️  处理 $MY_INSTANCE 的消息..."
    for msg_file in "$QUEUE_DIR"/*.json; do
        [ -f "$msg_file" ] || continue
        TO_INSTANCE=$(cat "$msg_file" | grep -o '"to": *"[^"]*"' | cut -d'"' -f4)
        if [ "$TO_INSTANCE" = "$MY_INSTANCE" ]; then
            MSG_ID=$(basename "$msg_file" .json)
            echo "处理消息: $MSG_ID"
            cat "$msg_file"
            mv "$msg_file" "$PROCESSED_DIR/"
            echo "✅ 已移动到 $PROCESSED_DIR/${MSG_ID}.json"
            echo ""
        fi
    done
fi
