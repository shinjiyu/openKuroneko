# 里程碑需要验证关键文件是否已读取并完成状态同步

> category: file | id: s-f79ce0 | 2026-03-06T09:15:23.745Z

场景：里程碑需要验证关键文件是否已读取并完成状态同步
步骤：
1. 读取 knowledge.md 检查历史记录，避免重复扫描
2. 读取 milestones.md 确认当前里程碑状态
3. 实际读取关键文件（overview.md/project-structure.md/snake.html）验证完整性
4. 使用 edit_file 更新里程碑状态（[Active] → [Completed]）
5. 再次读取 milestones.md 验证状态更新成功
验证：milestones.md 中目标里程碑状态为 [Completed]，且关键文件已实际读取
