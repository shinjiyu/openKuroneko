# 里程碑状态更新操作

> category: file | id: s-9ce38b | 2026-03-06T09:15:23.758Z

场景：里程碑状态更新操作
步骤：
1. 使用 edit_file 修改 .brain/milestones.md
2. 将目标行的 [Active] 改为 [Completed]
3. 使用 read_file 验证修改结果
验证：重新读取 milestones.md 确认状态变更成功
