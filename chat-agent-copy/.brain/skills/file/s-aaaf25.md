# 里程碑状态为 [Active] 但 knowledge.md 显示任务已于之前周期完成，需验证交付物并同步状态

> category: file | id: s-aaaf25 | 2026-03-06T09:15:23.754Z

场景：里程碑状态为 [Active] 但 knowledge.md 显示任务已于之前周期完成，需验证交付物并同步状态

步骤：
1. read_file(.brain/knowledge.md) 获取历史事实基线，识别任务完成记录
2. read_file(交付物路径) 实际验证文件存在性和内容完整性（检查关键模块/章节）
3. read_file(.brain/milestones.md) 确认当前里程碑状态为 [Active]
4. edit_file(.brain/milestones.md) 更新目标里程碑状态为 [Completed]
5. read_file(.brain/milestones.md) 二次验证确认更新成功

验证：milestones.md 中目标里程碑状态为 [Completed]，交付物实际存在且内容完整
