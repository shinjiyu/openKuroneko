# 里程碑任务已完成（交付物在之前步骤创建），需要验证并更新状态

> category: file | id: s-de8b5c | 2026-03-06T09:15:23.761Z

场景：里程碑任务已完成（交付物在之前步骤创建），需要验证并更新状态
步骤：
  1. 读取 milestones.md 确认当前 Active 任务
  2. 读取目标交付物文件，验证内容完整性和质量
  3. 执行辅助命令（如 find、ls）二次验证环境状态
  4. 使用 edit_file 将里程碑状态从 [Active] 改为 [Completed]
  5. 读取 milestones.md 确认更新成功
验证：交付物文件存在且内容完整 + milestones.md 中对应条目显示 [Completed]
