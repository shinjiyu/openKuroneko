# 验证已完成的里程碑（knowledge.md 有历史记录，但 milestones.md 状态未同步）

> category: file | id: s-25dd9e | 2026-03-06T09:15:23.750Z

场景：验证已完成的里程碑（knowledge.md 有历史记录，但 milestones.md 状态未同步）

步骤：
1. read_file(.brain/knowledge.md) 检查历史完成记录
2. read_file(<交付物文件>) 验证实际内容完整性
3. read_file(.brain/milestones.md) 确认当前状态
4. edit_file(.brain/milestones.md) 仅当状态为 [Active] 时执行状态同步
5. read_file(.brain/milestones.md) 二次验证更新成功

验证：milestones.md 中目标里程碑状态为 [Completed]，且未触发 old_string not found 错误
