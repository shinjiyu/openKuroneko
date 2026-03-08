# 极简项目需要通过读取核心文件完成知识获取里程碑（M2），项目已有 knowledge.md 历史事实基线

> category: file | id: s-ec33e0 | 2026-03-06T09:15:23.752Z

场景：极简项目需要通过读取核心文件完成知识获取里程碑（M2），项目已有 knowledge.md 历史事实基线

步骤：
1. 读取 .brain/knowledge.md 获取历史事实基线（100+ 条记录），了解项目结构、文件状态和历史里程碑完成情况
2. 读取 .brain/milestones.md 确认当前里程碑目标和状态
3. 读取核心业务文件（overview.md/project-structure.md/snake.html）验证内容完整性
4. 使用 edit_file 更新 milestones.md，将目标里程碑状态从 [Active] 改为 [Completed]
5. 使用 read_file 二次验证 milestones.md，确认状态更新成功

验证：
- 所有核心文件均成功读取且内容完整（overview.md 包含 6 大模块、project-structure.md 包含三层结构、snake.html 包含完整游戏源码）
- 项目逻辑已理解（极简项目 + 单文件 Canvas 游戏应用 + 零外部依赖）
- milestones.md 状态已成功从 [Active] 同步为 [Completed]
- 执行耗时约 40-60 秒，实现零冗余的里程碑完成流程
