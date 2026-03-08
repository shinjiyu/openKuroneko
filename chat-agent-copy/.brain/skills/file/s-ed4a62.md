# 验证已完成的里程碑交付物（文档已存在但状态未同步）

> category: file | id: s-ed4a62 | 2026-03-06T09:15:23.752Z

场景：验证已完成的里程碑交付物（文档已存在但状态未同步）
步骤：
1. 读取 knowledge.md 检查历史完成记录（避免重复生成）
2. 读取实际交付物文件验证内容完整性（确认 6 大模块存在）
3. 读取 milestones.md 确认当前状态（识别 Active 标记）
4. 使用 edit_file 同步状态（old_string: "[M3] [Active]" → new_string: "[M3] [Completed]"）
5. 读取 milestones.md 二次验证更新成功
验证：milestones.md 中对应里程碑显示 [Completed]，且交付物文件包含完整内容
