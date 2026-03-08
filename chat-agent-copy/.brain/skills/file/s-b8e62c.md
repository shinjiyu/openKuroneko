# 需要验证里程碑交付物（如 overview.md）是否已存在且内容完整，并同步里程碑状态

> category: file | id: s-b8e62c | 2026-03-06T09:15:23.752Z

场景：需要验证里程碑交付物（如 overview.md）是否已存在且内容完整，并同步里程碑状态

步骤：
1. 读取 knowledge.md 检查历史完成记录（避免重复工作）
2. 读取实际交付文件验证内容完整性（如 overview.md 的 6 大模块）
3. 读取 milestones.md 确认当前状态
4. 使用 edit_file 将里程碑状态从 [Active] 更新为 [Completed]
5. 二次读取 milestones.md 验证更新成功

验证：milestones.md 中对应里程碑状态显示 [Completed]，交付物文件内容完整
