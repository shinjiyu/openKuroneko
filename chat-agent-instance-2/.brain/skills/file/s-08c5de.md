# M2 里程碑验证 - 极简项目关键文件识别与读取

> category: file | id: s-08c5de | 2026-03-06T09:15:23.755Z

场景：M2 里程碑验证 - 极简项目关键文件识别与读取

步骤：
1. 读取 knowledge.md 历史记录，获取项目结构基线和历史完成情况
2. 读取 milestones.md 确认当前里程碑状态
3. 读取核心文件（overview.md/project-structure.md/snake.html）验证内容完整性
4. 使用 edit_file 更新里程碑状态（[Active] → [Completed]）
5. 读取 milestones.md 二次验证更新成功

验证：milestones.md 中 M2 状态为 [Completed]，且 3 个核心文件内容完整可读
