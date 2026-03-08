#!/bin/bash
# 实例间通信演示脚本
set -e

CHANNEL_DIR="/Users/user/Documents/openKuroneko/inter-instance-channel"
cd "$CHANNEL_DIR"

echo "========================================"
echo "  openKuroneko 实例间通信演示"
echo "========================================"
echo ""

echo "📋 步骤 1: 检查实例注册状态"
echo "--------------------------------------"
./query_status.sh || true
echo ""

echo "📋 步骤 2: 发送测试消息（Original -> Replica）"
echo "--------------------------------------"
./send_message.sh kuroneko-original kuroneko-replica task_request '{
  "task": "analyze_logs",
  "priority": "high",
  "details": "分析昨天的错误日志"
}'
echo ""

echo "📋 步骤 3: 发送测试消息（Replica -> Original）"
echo "--------------------------------------"
./send_message.sh kuroneko-replica kuroneko-original status_report '{
  "status": "working",
  "progress": "50%",
  "current_task": "analyzing logs"
}'
echo ""

echo "📋 步骤 4: 查看待处理消息"
echo "--------------------------------------"
echo "Replica 的消息队列:"
./receive_messages.sh kuroneko-replica
echo ""
echo "Original 的消息队列:"
./receive_messages.sh kuroneko-original
echo ""

echo "📋 步骤 5: 处理消息（带自动回复）"
echo "--------------------------------------"
echo "Replica 处理消息:"
./message_processor.sh kuroneko-replica --auto-reply
echo ""
echo "Original 处理消息:"
./message_processor.sh kuroneko-original --auto-reply
echo ""

echo "📋 步骤 6: 查看已处理消息"
echo "--------------------------------------"
ls -lh processed/ 2>/dev/null || echo "暂无已处理消息"
echo ""

echo "========================================"
echo "  演示完成！"
echo "========================================"
echo ""
echo "💡 使用方法："
echo "  - 发送消息: ./send_message.sh <from> <to> <type> <payload>"
echo "  - 接收消息: ./receive_messages.sh <instance_id>"
echo "  - 处理消息: ./message_processor.sh <instance_id> [--auto-reply]"
echo "  - 查询状态: ./query_status.sh"
echo ""
