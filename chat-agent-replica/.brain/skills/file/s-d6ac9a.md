# 里程碑已完成（knowledge.md 有历史记录），但 milestones.md 状态仍为 [Active]，需要快

> category: file | id: s-d6ac9a | 2026-03-06T09:15:23.757Z

场景：里程碑已完成（knowledge.md 有历史记录），但 milestones.md 状态仍为 [Active]，需要快速同步状态

步骤：
1. 读取 .brain/knowledge.md，检查历史事实记录，确认里程碑交付物是否已存在
2. 读取 .brain/milestones.md，确认当前状态标记
3. 如果历史记录显示已完成，实际读取核心文件验证内容完整性
4. 使用 edit_file 将里程碑状态从 [Active] 更新为 [Completed]
5. 读取 milestones.md 二次验证更新成功

验证：milestones.md 中目标里程碑状态为 [Completed]，且无重复工具调用
