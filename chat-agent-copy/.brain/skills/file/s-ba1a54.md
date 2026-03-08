# 里程碑交付物已在前置步骤创建，需要验证并更新里程碑状态

> category: file | id: s-ba1a54 | 2026-03-06T09:15:23.762Z

场景：里程碑交付物已在前置步骤创建，需要验证并更新里程碑状态
步骤：
1. 读取交付物文件，确认内容完整且符合要求
2. 读取 .brain/milestones.md，定位当前里程碑行
3. 使用 edit_file 精确替换：将 [Active] 改为 [Completed]
4. 再次读取 milestones.md 验证状态更新成功
验证：二次读取 milestones.md 确认目标里程碑状态已变更为 [Completed]
