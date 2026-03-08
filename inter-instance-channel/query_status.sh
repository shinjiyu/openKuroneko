#!/bin/bash
# query_status.sh - 查询所有实例状态
set -e

CHANNEL_DIR="/Users/user/Documents/openKuroneko/inter-instance-channel"
STATUS_DIR="$CHANNEL_DIR/status"

echo "🔍 实例状态概览"
echo "=================="

for status_file in "$STATUS_DIR"/*.json; do
    [ -f "$status_file" ] || continue
    INSTANCE_ID=$(basename "$status_file" .json)
    
    echo ""
    echo "实例: $INSTANCE_ID"
    echo "--------------------------------"
    cat "$status_file" | python3 -m json.tool 2>/dev/null || cat "$status_file"
done

echo ""
echo "=================="
echo "💡 使用 register_instance.sh 注册新实例"
