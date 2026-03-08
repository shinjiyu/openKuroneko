# 里程碑完成验证与状态同步

> category: file | id: s-207ced | 2026-03-06T09:15:23.750Z

场景：里程碑完成验证与状态同步
步骤：
  1. 读取 .brain/milestones.md 获取当前里程碑目标
  2. 读取 .brain/knowledge.md 检查历史完成记录
  3. 执行最小化验证操作（如 find/ls/read_file）确认交付物存在
  4. 使用 edit_file 同步里程碑状态（[Active] → [Completed]）
  5. 读取 .brain/milestones.md 二次验证更新成功
验证：milestones.md 中目标里程碑状态为 [Completed]，且无冗余工具调用
