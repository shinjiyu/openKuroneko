#!/bin/bash
# 实例间通信脚本
# 用法: ./inter-instance.sh <command> [args...]

SHARED_DIR="/Users/user/Documents/openKuroneko/chat-agent/.shared"
INSTANCES_DIR="$SHARED_DIR/instances"
MESSAGES_DIR="$SHARED_DIR/messages"

# 确保目录存在
mkdir -p "$INSTANCES_DIR" "$MESSAGES_DIR"

send_message() {
  local from="$1"
  local to="$2"
  local type="$3"
  local payload="$4"
  local msg_id="msg-$(date +%s%N | md5sum | cut -c1-8)"
  local timestamp=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
  
  cat > "$MESSAGES_DIR/$msg_id.json" << MSGEOF
{
  "id": "$msg_id",
  "from": "$from",
  "to": "$to",
  "type": "$type",
  "payload": $payload,
  "timestamp": "$timestamp",
  "status": "pending"
}
MSGEOF
  
  echo "✅ 消息已发送: $msg_id"
  echo "   从: $from"
  echo "   到: $to"
  echo "   类型: $type"
}

receive_messages() {
  local instance_id="$1"
  echo "📬 检查 $instance_id 的待收消息..."
  
  local count=0
  for msg_file in "$MESSAGES_DIR"/*.json; do
    [ -f "$msg_file" ] || continue
    
    local to=$(jq -r '.to' "$msg_file")
    if [ "$to" == "$instance_id" ] || [ "$to" == "*" ]; then
      local msg_id=$(basename "$msg_file" .json)
      echo "---"
      echo "📨 消息 ID: $msg_id"
      jq -r '"来源: \(.from)\n类型: \(.type)\n时间: \(.timestamp)\n内容: \(.payload)"' "$msg_file"
      
      # 标记为已读
      jq '.status = "read"' "$msg_file" > "$msg_file.tmp"
      mv "$msg_file.tmp" "$msg_file"
      
      ((count++))
    fi
  done
  
  if [ $count -eq 0 ]; then
    echo "  无新消息"
  else
    echo "---"
    echo "  共 $count 条消息"
  fi
}

list_instances() {
  echo "📋 已注册的实例:"
  echo ""
  for instance_file in "$INSTANCES_DIR"/*.json; do
    [ -f "$instance_file" ] || continue
    local name=$(jq -r '.name' "$instance_file")
    local webchat_port=$(jq -r '.webchat_port' "$instance_file")
    local pid=$(jq -r '.pid' "$instance_file")
    local status=$(jq -r '.status' "$instance_file")
    echo "  • $name"
    echo "    端口: $webchat_port | PID: $pid | 状态: $status"
    echo "    工作目录: $(jq -r '.work_dir' "$instance_file")"
    echo ""
  done
}

register_instance() {
  local name="$1"
  local work_dir="$2"
  local temp_dir="$3"
  local webchat_port="$4"
  local pid="$5"
  
  cat > "$INSTANCES_DIR/$name.json" << INSTEOF
{
  "name": "$name",
  "work_dir": "$work_dir",
  "temp_dir": "$temp_dir",
  "webchat_port": $webchat_port,
  "pid": $pid,
  "status": "running",
  "registered_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
INSTEOF
  
  echo "✅ 实例已注册: $name"
}

case "$1" in
  send)
    send_message "$2" "$3" "$4" "$5"
    ;;
  receive)
    receive_messages "$2"
    ;;
  list)
    list_instances
    ;;
  register)
    register_instance "$2" "$3" "$4" "$5" "$6"
    ;;
  *)
    echo "实例间通信工具"
    echo ""
    echo "用法:"
    echo "  $0 send <from> <to> <type> '<json-payload>'"
    echo "  $0 receive <instance-id>"
    echo "  $0 list"
    echo "  $0 register <name> <work-dir> <temp-dir> <port> <pid>"
    echo ""
    echo "示例:"
    echo "  $0 send kuroneko-original kuroneko-replica task '{\"goal\":\"测试任务\"}'"
    echo "  $0 receive kuroneko-replica"
    ;;
esac
