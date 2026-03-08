# 里程碑状态验证与同步（避免重复执行已完成的扫描任务）

> category: file | id: s-1aa82d | 2026-03-06T09:15:23.745Z

场景：里程碑状态验证与同步（避免重复执行已完成的扫描任务）

步骤：
1. read_file(.brain/knowledge.md) 获取历史事实记录
2. read_file(.brain/milestones.md) 检查当前里程碑状态
3. 执行最小化验证操作（如 find 命令扫描目录）
4. edit_file(.brain/milestones.md) 更新状态（[Active] → [Completed]）
5. read_file(.brain/milestones.md) 二次验证更新成功

验证：
- milestones.md 文件大小变化（498 → 501 bytes）
- 二次读取确认状态标记已变为 [Completed]
- knowledge.md 追加完成记录（时间戳 + 里程碑编号）
