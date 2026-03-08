# 里程碑状态同步任务（交付物已在历史周期完成）

> category: file | id: s-8fa66e | 2026-03-06T09:15:23.756Z

场景：里程碑状态同步任务（交付物已在历史周期完成）
步骤：
1. 读取 knowledge.md 检查历史完成记录（避免重复生成）
2. 读取实际交付物文件验证内容完整性（确认 6 大模块齐全）
3. 调用 edit_file 更新 milestones.md 状态（[Active] → [Completed]）
4. 调用 read_file 二次验证状态更新成功
验证：read_file 返回的 milestones.md 显示目标里程碑状态为 [Completed]
