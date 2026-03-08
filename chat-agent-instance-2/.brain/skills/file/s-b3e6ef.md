# 需要验证文档类里程碑是否完成（文档已存在且内容完整，仅需状态同步）

> category: file | id: s-b3e6ef | 2026-03-06T09:15:23.748Z

场景：需要验证文档类里程碑是否完成（文档已存在且内容完整，仅需状态同步）

步骤：
1. 读取 .brain/knowledge.md 检查历史记录，确认文档已在之前周期生成
2. 读取目标文档文件，验证实际存在性和内容完整性（检查关键模块/章节）
3. 读取 .brain/milestones.md 确认当前状态
4. 使用 edit_file 将里程碑状态从 [Active] 更新为 [Completed]
5. 再次读取 .brain/milestones.md 二次验证状态更新成功

验证：
- 文档文件存在且包含预期的完整内容
- milestones.md 中对应里程碑状态为 [Completed]
- 二次读取确认状态更新持久化成功
