# 里程碑状态同步任务，需要验证目录结构并更新里程碑状态

> category: file | id: s-6b91ef | 2026-03-06T09:15:23.753Z

场景：里程碑状态同步任务，需要验证目录结构并更新里程碑状态
步骤：
1. read_file(.brain/knowledge.md) 检查历史记录，确认项目事实基线
2. shell_exec(find . -maxdepth 2 -type f -o -type d) 实际扫描目录结构
3. edit_file(.brain/milestones.md) 将目标里程碑状态从 [Active] 更新为 [Completed]
4. read_file(.brain/milestones.md) 二次验证状态更新成功
验证：milestones.md 文件中目标里程碑状态为 [Completed]，文件大小增加 3 bytes（"[Active]" → "[Completed]"）
