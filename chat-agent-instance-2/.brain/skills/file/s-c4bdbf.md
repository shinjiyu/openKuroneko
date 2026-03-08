# M2 里程碑执行 - 需要检查知识库并读取核心文件以理解项目

> category: file | id: s-c4bdbf | 2026-03-06T09:15:23.751Z

场景：M2 里程碑执行 - 需要检查知识库并读取核心文件以理解项目
步骤：
  1. 读取 .brain/knowledge.md 获取历史事实基线（100+ 条记录）
  2. 读取 .brain/milestones.md 检查当前里程碑状态
  3. 按优先级读取未验证的核心文件（overview.md → project-structure.md → snake.html）
  4. 使用 edit_file 更新 milestones.md 状态（[Active] → [Completed]）
  5. 使用 read_file 二次验证确认状态同步成功
验证：milestones.md 中 M2 状态已从 [Active] 变更为 [Completed]，且通过二次读取确认更新成功
