# 验证已生成文档类里程碑（如 overview.md/project-structure.md），避免重复生成内容

> category: file | id: s-e2de44 | 2026-03-06T09:15:23.755Z

场景：验证已生成文档类里程碑（如 overview.md/project-structure.md），避免重复生成内容

步骤：
1. 读取 knowledge.md 历史记录，确认交付物已在之前周期生成
2. 读取实际文件验证内容完整性（检查标准模块是否存在）
3. 读取 milestones.md 获取当前里程碑状态
4. 使用 edit_file 同步状态（[Active] → [Completed]）
5. 使用 read_file 二次验证状态更新成功

验证：read_file(milestones.md) 确认目标里程碑状态为 [Completed]，文件内容包含预期的标准模块
