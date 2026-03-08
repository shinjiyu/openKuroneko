# 完成里程碑任务后需要更新状态并推进下一阶段

> category: file | id: s-e3fdcc | 2026-03-06T09:15:23.761Z

场景：完成里程碑任务后需要更新状态并推进下一阶段
步骤：
1. 读取 .brain/milestones.md 确认当前里程碑定义
2. 使用 edit_file 工具将对应里程碑的 [Active] 改为 [Completed]
3. 再次读取 milestones.md 验证状态更新成功
4. 检查下一里程碑的依赖条件是否满足
验证：milestones.md 中目标里程碑状态已变更为 [Completed]，且无格式错误
