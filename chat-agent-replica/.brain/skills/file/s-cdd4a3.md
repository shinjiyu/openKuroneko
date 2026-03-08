# 需要验证交付物文件存在后，更新里程碑状态为 Completed

> category: file | id: s-cdd4a3 | 2026-03-06T09:15:23.747Z

场景：需要验证交付物文件存在后，更新里程碑状态为 Completed

步骤：
1. 读取 .brain/milestones.md 确认目标里程碑当前为 Active 状态
2. 读取/验证目标文件存在且内容符合预期
3. 使用 edit_file 将里程碑状态从 [Active] 改为 [Completed]
4. 再次读取 milestones.md 确认更新成功

验证：里程碑文件中目标行显示 [Completed]，且文件大小增加（Active → Completed 字符增加）
