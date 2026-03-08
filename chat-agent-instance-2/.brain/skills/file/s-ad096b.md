# 里程碑状态不一致（knowledge.md 记录完成，但 milestones.md 状态未更新）

> category: file | id: s-ad096b | 2026-03-06T09:15:23.748Z

场景：里程碑状态不一致（knowledge.md 记录完成，但 milestones.md 状态未更新）
步骤：
  1. 读取 knowledge.md 检查历史完成记录
  2. 读取 milestones.md 确认当前状态
  3. 使用 edit_file 将 [Active] 替换为 [Completed]
  4. 二次读取 milestones.md 验证更新成功
验证：milestones.md 中对应里程碑显示 [Completed]，且与 knowledge.md 记录一致
