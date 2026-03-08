# 里程碑目标为创建或验证某个交付物（文档/代码/配置），且 knowledge.md 已记录该交付物在历史周期中完成

> category: file | id: s-06d8ba | 2026-03-06T09:15:23.751Z

场景：里程碑目标为创建或验证某个交付物（文档/代码/配置），且 knowledge.md 已记录该交付物在历史周期中完成

步骤：
1. 读取 .brain/knowledge.md 获取历史事实基线，确认交付物已完成时间
2. 读取目标文件验证实际存在性和内容完整性（检查关键章节/模块）
3. 读取 .brain/milestones.md 确认当前里程碑状态
4. 使用 edit_file 将里程碑状态从 [Active] 更新为 [Completed]
5. 再次读取 milestones.md 二次验证状态更新成功

验证：二次读取 milestones.md 确认目标里程碑已标记为 [Completed]，且目标文件内容完整
