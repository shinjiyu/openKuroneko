# 验证已完成的里程碑（M1 目录扫描类型）

> category: file | id: s-e63ab7 | 2026-03-06T09:15:23.762Z

场景：验证已完成的里程碑（M1 目录扫描类型）
步骤：
1. read_file(.brain/knowledge.md) 检查历史记录，确认是否已有完成记录
2. shell_exec(find . -maxdepth 2 -type f -o -type d | sort) 实际扫描验证目录结构未变
3. edit_file(.brain/milestones.md) 更新状态 [Active] → [Completed]
4. read_file(.brain/milestones.md) 二次验证状态更新成功
验证：二次 read_file 确认里程碑状态已更新为 [Completed]，且目录结构与历史记录一致
