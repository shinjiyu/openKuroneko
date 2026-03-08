# 里程碑交付物验证与状态同步（验证文件存在性、内容完整性，并更新里程碑状态）

> category: file | id: s-fb8b36 | 2026-03-06T09:15:23.759Z

场景：里程碑交付物验证与状态同步（验证文件存在性、内容完整性，并更新里程碑状态）

步骤：
1. 读取 .brain/milestones.md 确认当前里程碑状态
2. 读取目标文件验证存在性和内容完整性（检查关键章节/结构）
3. 使用 edit_file 将里程碑状态从 [Active] 更新为 [Completed]
4. 再次读取 milestones.md 验证更新成功

验证：最终读取的 milestones.md 中目标里程碑显示 [Completed]
