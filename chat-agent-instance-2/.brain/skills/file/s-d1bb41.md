# 验证里程碑完成状态并同步 milestones.md

> category: file | id: s-d1bb41 | 2026-03-06T09:15:23.754Z

场景：验证里程碑完成状态并同步 milestones.md

步骤：
1. 读取 knowledge.md 检查历史完成记录（避免重复执行）
2. 读取 milestones.md 确认当前状态
3. 读取/验证关键文件确认交付物完整性
4. 使用 edit_file 将里程碑状态从 [Active] 改为 [Completed]
5. 读取 milestones.md 二次验证更新成功

验证：二次读取 milestones.md 确认目标里程碑已标记为 [Completed]
