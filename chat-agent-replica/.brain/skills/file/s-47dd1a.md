# 需要验证交付物完成情况并更新里程碑状态

> category: file | id: s-47dd1a | 2026-03-06T09:15:23.757Z

场景：需要验证交付物完成情况并更新里程碑状态
步骤：
1. 读取目标交付物文件，检查内容完整性和质量
2. 读取 milestones.md 确认当前里程碑状态
3. 使用 edit_file 将对应里程碑从 [Active] 改为 [Completed]
4. 重新读取 milestones.md 验证状态更新成功
验证：最终 milestones.md 中目标里程碑显示为 [Completed]
