# 极简项目里程碑验证（目标为"扫描目录结构"等基础任务，且 knowledge.md 已有历史记录）

> category: file | id: s-feff53 | 2026-03-06T09:15:23.746Z

场景：极简项目里程碑验证（目标为"扫描目录结构"等基础任务，且 knowledge.md 已有历史记录）
步骤：
1. 读取 knowledge.md 检查历史完成记录
2. 使用 shell 命令（如 find . -maxdepth 2）快速验证当前状态
3. 读取 milestones.md 确认当前状态
4. 使用 edit_file 更新里程碑状态（Active → Completed）
5. 读取 milestones.md 二次验证更新成功
验证：milestones.md 中目标里程碑标记为 [Completed]，且与实际目录结构一致
