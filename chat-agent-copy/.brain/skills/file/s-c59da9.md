# 里程碑已在之前周期完成，但 milestones.md 状态仍为 [Active] 需要同步

> category: file | id: s-c59da9 | 2026-03-06T09:15:23.754Z

场景：里程碑已在之前周期完成，但 milestones.md 状态仍为 [Active] 需要同步
步骤：
1. 读取 knowledge.md 检查历史记录（确认任务已完成）
2. 读取实际交付物验证内容完整性
3. 使用 edit_file 将里程碑状态从 [Active] 更新为 [Completed]
4. 读取 milestones.md 二次验证更新成功
验证：二次读取确认状态已成功更新，且未重复执行已完成的工作
