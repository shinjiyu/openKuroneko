#!/bin/bash
# start_monitor.sh - 启动实例消息监控和心跳更新

CHANNEL_DIR="/Users/user/Documents/openKuroneko/inter-instance-channel"

if [ $# -lt 1 ]; then
    echo "用法: $0 <instance_id> [interval_seconds]"
    echo "示例: $0 kuroneko-original 10"
    exit 1
fi

INSTANCE_ID="$1"
INTERVAL="${2:-10}"

echo "🔍 启动实例监控: $INSTANCE_ID"
echo "   检查间隔: ${INTERVAL}秒"
echo "   按 Ctrl+C 停止"
echo ""

# 捕获退出信号
trap 'echo ""; echo "🛑 监控已停止"; exit 0' SIGINT SIGTERM

while true; do
    # 更新心跳
    bash "$CHANNEL_DIR/update_heartbeat.sh" "$INSTANCE_ID" 2>/dev/null
    
    # 检查消息
    MESSAGES=$(find "$CHANNEL_DIR/queue" -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
    
    if [ "$MESSAGES" -gt 0 ]; then
        echo "[$(date '+%H:%M:%S')] 📬 发现 $MESSAGES 条待处理消息"
        bash "$CHANNEL_DIR/message_processor.sh" "$INSTANCE_ID" --auto-reply 2>/dev/null
    fi
    
    sleep "$INTERVAL"
done
