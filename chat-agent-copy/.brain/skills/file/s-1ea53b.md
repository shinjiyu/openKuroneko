# 需要验证并完成里程碑（如 M3: 生成 overview.md 总结报告），但交付物可能已存在。

> category: file | id: s-1ea53b | 2026-03-06T09:15:23.758Z

场景：需要验证并完成里程碑（如 M3: 生成 overview.md 总结报告），但交付物可能已存在。
步骤：
1) read_file(.brain/knowledge.md) 查询历史事实与完成状态。
2) read_file(.brain/milestones.md) 确认当前里程碑状态。
3) read_file(<交付物>) 验证内容完整性与必需章节。
4) edit_file(.brain/milestones.md) 将对应里程碑从 [Active] 更新为 [Completed]。
5) read_file(.brain/milestones.md) 二次验证状态更新成功。
验证：里程碑状态为 [Completed]，且交付物存在且包含必需章节（如 6 大模块），全程无冗余生成。
