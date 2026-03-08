# 里程碑完成验证（需确认任务已完成并更新状态标记）

> category: file | id: s-e9fcc8 | 2026-03-06T09:15:23.745Z

场景：里程碑完成验证（需确认任务已完成并更新状态标记）

步骤：
1. 读取 knowledge.md 检查历史记录，了解已掌握的事实和之前的里程碑完成情况
2. 读取 milestones.md 确认当前里程碑状态（Active/Pending）
3. 对目标里程碑涉及的核心文件进行实际读取验证（不盲目依赖历史记录）
4. 使用 edit_file 工具更新 milestones.md 状态（[Active] → [Completed]）
5. 再次读取 milestones.md 二次验证状态更新成功

验证：
- milestones.md 中目标里程碑状态已变为 [Completed]
- 所有涉及的核心文件均已成功读取（工具返回 ok: true）
