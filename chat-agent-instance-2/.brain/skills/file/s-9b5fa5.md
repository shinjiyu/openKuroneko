# 里程碑完成验证与状态同步（文档已存在但 milestones.md 未更新）

> category: file | id: s-9b5fa5 | 2026-03-06T09:15:23.749Z

场景：里程碑完成验证与状态同步（文档已存在但 milestones.md 未更新）
步骤：
1. 读取 .brain/knowledge.md 检查历史记录，确认任务是否已在之前周期完成
2. 读取实际交付物文件（如 overview.md），验证内容完整性
3. 读取 .brain/milestones.md 确认当前状态
4. 使用 edit_file 将对应里程碑从 [Active] 更新为 [Completed]
5. 二次读取 milestones.md 验证状态更新成功
验证：milestones.md 中目标里程碑状态已从 [Active] 变为 [Completed]，且二次读取确认更新持久化
