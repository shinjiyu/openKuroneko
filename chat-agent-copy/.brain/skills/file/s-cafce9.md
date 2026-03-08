# 里程碑状态同步任务（knowledge.md 记录已完成但 milestones.md 未同步）

> category: file | id: s-cafce9 | 2026-03-06T09:15:23.744Z

场景：里程碑状态同步任务（knowledge.md 记录已完成但 milestones.md 未同步）
步骤：
  1. read_file(.brain/knowledge.md) 查询历史完成记录
  2. read_file(.brain/milestones.md) 检查当前状态
  3. 如发现不一致，使用 edit_file 批量更新所有里程碑状态（一次操作完成所有更新）
  4. read_file(.brain/milestones.md) 验证最终状态
验证：最终 milestones.md 中所有相关里程碑都标记为 [Completed]
