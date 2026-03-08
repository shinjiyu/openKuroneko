# 需要完成「读取核心文件内容」类里程碑（如 M2），要求避免重复读取已有文件

> category: file | id: s-88dad4 | 2026-03-06T09:15:23.749Z

场景：需要完成「读取核心文件内容」类里程碑（如 M2），要求避免重复读取已有文件

步骤：
1. 读取 knowledge.md 检查历史记录，确认哪些文件已在之前周期读取
2. 对比 milestones.md 当前状态，识别需要验证的文件列表
3. 仅读取未在当前会话验证过的关键文件（overview.md、project-structure.md、snake.html 等）
4. 验证文件内容完整性（结构分析、模块完整性、源码完整性）
5. 显式调用 edit_file 更新 milestones.md 状态（[Active] → [Completed]）
6. 调用 read_file 二次验证 milestones.md 更新成功

验证：
- knowledge.md 历史记录已检查
- 所有关键文件已在当前会话实际读取
- milestones.md 状态成功更新为 [Completed]
- 二次读取确认状态同步成功
