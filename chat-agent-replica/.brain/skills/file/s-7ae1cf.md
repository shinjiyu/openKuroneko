# 执行"读取关键文件内容"类里程碑，需验证历史记录避免重复读取

> category: file | id: s-7ae1cf | 2026-03-06T09:15:23.745Z

场景：执行"读取关键文件内容"类里程碑，需验证历史记录避免重复读取

步骤：
1. 读取 .brain/knowledge.md，提取历史已读文件列表和内容摘要
2. 根据里程碑描述识别目标文件（如 overview.md、project-structure.md、核心业务文件）
3. 对比 knowledge.md 历史记录，确认文件内容是否已在之前周期读取
4. 如已读取且内容完整，仅执行状态同步（milestones.md: Active → Completed）
5. 如未读取或内容不完整，执行文件读取并记录新事实到 knowledge.md

验证：最终 milestones.md 状态为 Completed，且 knowledge.md 包含完整的文件内容摘要
