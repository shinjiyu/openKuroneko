# 里程碑验证完成，需要将状态从 Active 更新为 Completed

> category: file | id: s-5b6be5 | 2026-03-06T09:15:23.762Z

场景：里程碑验证完成，需要将状态从 Active 更新为 Completed
步骤：
  1. 读取里程碑文件 .brain/milestones.md 确认当前状态
  2. 使用 edit_file 精确替换："[M*] [Active]" → "[M*] [Completed]"
  3. 二次读取验证状态更新成功
验证：读取里程碑文件，确认目标里程碑行显示 [Completed]
