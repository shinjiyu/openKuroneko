# 完成里程碑任务后需要标记完成状态

> category: file | id: s-efedc6 | 2026-03-06T09:15:23.757Z

场景：完成里程碑任务后需要标记完成状态
步骤：
  1. 使用 edit_file 工具更新 .brain/milestones.md，将对应里程碑的 [Active] 改为 [Completed]
  2. 使用 read_file 工具重新读取 milestones.md 验证状态已正确更新
验证：确认 milestones.md 中目标里程碑状态已从 Active 变为 Completed
