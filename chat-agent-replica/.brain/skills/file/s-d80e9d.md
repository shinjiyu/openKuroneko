# 里程碑状态同步操作

> category: file | id: s-d80e9d | 2026-03-06T09:15:23.759Z

场景：里程碑状态同步操作
步骤：
1. 读取 knowledge.md 检查历史完成记录
2. 读取 milestones.md 确认当前状态（如已是 [Completed] 则跳过后续步骤）
3. 仅当状态为 [Active] 时执行 edit_file 状态同步
4. 执行一次 read_file 二次验证
验证：milestones.md 中目标里程碑状态为 [Completed]
