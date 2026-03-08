# 里程碑状态同步 - 文件已存在但 milestones.md 状态未更新（Active → Completed）

> category: file | id: s-b2c68c | 2026-03-06T09:15:23.747Z

场景：里程碑状态同步 - 文件已存在但 milestones.md 状态未更新（Active → Completed）
步骤：
1. 读取 .brain/knowledge.md 检查历史完成记录
2. 读取目标文件验证内容完整性
3. 使用 edit_file 更新 milestones.md（[Active] → [Completed]）
4. 二次读取 milestones.md 验证更新成功
验证：milestones.md 目标里程碑状态为 [Completed]，且文件内容确认完整
