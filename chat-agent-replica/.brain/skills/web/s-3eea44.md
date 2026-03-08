# 里程碑状态不一致（knowledge.md 记录已完成但 milestones.md 显示 Pending/Active

> category: web | id: s-3eea44 | 2026-03-06T09:15:23.764Z

场景：里程碑状态不一致（knowledge.md 记录已完成但 milestones.md 显示 Pending/Active）
步骤：
1. 读取 knowledge.md 搜索 "[里程碑名] 里程碑完成" 关键词
2. 检查完成时间戳和交付物描述
3. 读取 milestones.md 确认当前状态
4. 使用 edit_file 将状态从 [Active]/[Pending] 更新为 [Completed]
5. 读取 milestones.md 二次验证更新成功
6. 停止操作，避免重复尝试
验证：milestones.md 中目标里程碑显示 [Completed]，二次读取确认状态已持久化
