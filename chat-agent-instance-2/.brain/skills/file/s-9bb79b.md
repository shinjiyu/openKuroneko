# 里程碑快速验证与状态同步（避免重复扫描）

> category: file | id: s-9bb79b | 2026-03-06T09:15:23.745Z

场景：里程碑快速验证与状态同步（避免重复扫描）
步骤：
1. 读取 .brain/knowledge.md，从历史记录中提取项目结构、文件存在性和历史完成状态
2. 执行最小化验证（如单次 find 或 read_file）确认当前状态与历史记录一致
3. 编辑 .brain/milestones.md，将对应里程碑从 [Active] 更新为 [Completed]
4. 再次读取 milestones.md 验证状态更新成功
验证：milestones.md 中目标里程碑状态为 [Completed]，且整个过程无重复扫描或冗余工具调用
