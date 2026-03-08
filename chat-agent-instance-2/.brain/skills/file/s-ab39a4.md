# 里程碑目标对应的交付物已存在，但 milestones.md 状态未同步（常见于跨会话或中断后恢复）

> category: file | id: s-ab39a4 | 2026-03-06T09:15:23.752Z

场景：里程碑目标对应的交付物已存在，但 milestones.md 状态未同步（常见于跨会话或中断后恢复）

步骤：
1. 读取 knowledge.md 历史记录，查找交付物的创建时间和完成状态
2. 实际读取交付物文件，验证内容完整性
3. 使用 edit_file 更新 milestones.md，将对应里程碑从 [Active]/[Pending] 改为 [Completed]
4. 使用 read_file 二次验证状态更新成功

验证：read_file(.brain/milestones.md) 显示目标里程碑状态为 [Completed]，且 knowledge.md 记录了本次状态同步操作
