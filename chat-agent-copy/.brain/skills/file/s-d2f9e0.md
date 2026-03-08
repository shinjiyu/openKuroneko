# 里程碑已完成但状态未同步（knowledge.md 有完成记录，milestones.md 仍为 Active）

> category: file | id: s-d2f9e0 | 2026-03-06T09:15:23.750Z

场景：里程碑已完成但状态未同步（knowledge.md 有完成记录，milestones.md 仍为 Active）
步骤：
  1. 读取 knowledge.md 检查历史完成记录
  2. 读取交付物文件验证内容完整性
  3. 读取 milestones.md 确认当前状态
  4. edit_file 将 [Active] 改为 [Completed]
  5. read_file 二次验证确认更新成功
验证：milestones.md 状态从 [Active] 变为 [Completed]，交付物文件存在且内容完整
