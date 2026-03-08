# M2 里程碑执行（识别并读取关键文件），需要避免重复扫描历史已完成的项目探索任务

> category: file | id: s-f4fe5f | 2026-03-06T09:15:23.756Z

场景：M2 里程碑执行（识别并读取关键文件），需要避免重复扫描历史已完成的项目探索任务

步骤：
1. 读取 .brain/knowledge.md 获取历史事实基线，快速了解项目结构、核心文件状态和历史里程碑完成情况
2. 基于 knowledge.md 定位核心文件列表（如 overview.md、project-structure.md、snake.html）
3. 使用 read_file 逐个验证核心文件存在性和内容完整性（检查关键章节或特征）
4. 使用 edit_file 同步里程碑状态（[Active] → [Completed]）
5. 使用 read_file 二次验证 milestones.md 确认状态更新成功

验证：milestones.md 中 M2 状态为 [Completed]，且所有核心文件已验证完整
