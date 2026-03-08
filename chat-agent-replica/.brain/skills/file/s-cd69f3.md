# 里程碑状态同步（交付物已存在但状态未更新）

> category: file | id: s-cd69f3 | 2026-03-06T09:15:23.755Z

场景：里程碑状态同步（交付物已存在但状态未更新）
步骤：
1. 读取 knowledge.md 检查历史完成记录
2. 读取实际交付物文件验证内容完整性
3. 使用 edit_file 将 milestones.md 中的 [Active] 替换为 [Completed]
4. 使用 read_file 二次验证状态更新成功
验证：milestones.md 显示 [Completed]，且交付物文件存在且内容完整
