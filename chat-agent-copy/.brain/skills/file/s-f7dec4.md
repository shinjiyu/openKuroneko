# 里程碑任务已在之前周期完成，但 milestones.md 状态未同步（[Active] 而非 [Completed]）

> category: file | id: s-f7dec4 | 2026-03-06T09:15:23.760Z

场景：里程碑任务已在之前周期完成，但 milestones.md 状态未同步（[Active] 而非 [Completed]）

步骤：
1. 读取 knowledge.md 检查历史记录，确认任务完成状态和交付物存在性
2. 读取 milestones.md 确认当前里程碑状态
3. 如果历史记录显示已完成但状态未同步，执行 edit_file 更新状态（[Active] → [Completed]）
4. 二次读取 milestones.md 验证更新成功

验证：milestones.md 中对应里程碑状态已成功更新为 [Completed]，且未重复执行已完成的任务
