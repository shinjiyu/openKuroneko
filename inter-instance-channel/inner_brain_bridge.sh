#!/bin/bash
# inner_brain_bridge.sh - 内脑与实例间通信的桥接工具

set -e

CHANNEL_DIR="/Users/user/Documents/openKuroneko/inter-instance-channel"

COMMAND="$1"
shift

case "$COMMAND" in
    send)
        # 发送消息: send <to_instance> <type> <payload>
        "$CHANNEL_DIR/send_message.sh" "$(hostname)-$(basename $(pwd))" "$@"
        ;;
    receive)
        # 接收消息: receive [instance_id]
        INSTANCE_ID="${1:-$(hostname)-$(basename $(pwd))}"
        "$CHANNEL_DIR/receive_messages.sh" "$INSTANCE_ID"
        ;;
    process)
        # 处理消息: process [instance_id] [--auto-reply]
        INSTANCE_ID="${1:-$(hostname)-$(basename $(pwd))}"
        shift || true
        "$CHANNEL_DIR/message_processor.sh" "$INSTANCE_ID" "$@"
        ;;
    status)
        # 查询状态
        "$CHANNEL_DIR/query_status.sh"
        ;;
    heartbeat)
        # 更新心跳
        INSTANCE_ID="${1:-$(hostname)-$(basename $(pwd))}"
        "$CHANNEL_DIR/update_heartbeat.sh" "$INSTANCE_ID"
        ;;
    *)
        echo "用法: $0 {send|receive|process|status|heartbeat}"
        echo ""
        echo "命令:"
        echo "  send <to_instance> <type> <payload>  - 发送消息"
        echo "  receive [instance_id]                 - 接收消息"
        echo "  process [instance_id] [--auto-reply]  - 处理消息"
        echo "  status                                - 查询所有实例状态"
        echo "  heartbeat [instance_id]               - 更新心跳"
        exit 1
        ;;
esac
