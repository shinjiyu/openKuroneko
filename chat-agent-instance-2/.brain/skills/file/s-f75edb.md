# 里程碑完成状态同步（文件已存在但状态仍为 Active）

> category: file | id: s-f75edb | 2026-03-06T09:15:23.750Z

场景：里程碑完成状态同步（文件已存在但状态仍为 Active）
步骤：
  1. 读取 knowledge.md 获取历史事实记录（90+ 条）
  2. 读取目标文件验证内容完整性（如 overview.md 需包含 6 大模块）
  3. 读取 milestones.md 确认当前状态
  4. edit_file 更新里程碑状态（[Active] → [Completed]）
  5. read_file 二次验证确认更新成功
验证：milestones.md 中目标里程碑状态已变为 [Completed]，交付物文件内容完整
