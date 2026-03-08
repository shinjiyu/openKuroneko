# 里程碑完成验证 - 需要确认交付物存在并更新里程碑状态

> category: file | id: s-b1f9e1 | 2026-03-06T09:15:23.750Z

场景：里程碑完成验证 - 需要确认交付物存在并更新里程碑状态
步骤：
  1. 读取 .brain/knowledge.md 获取历史基线，检查交付物是否已在之前周期创建
  2. 读取实际交付物文件（如 overview.md），验证内容完整性（检查关键模块/章节是否存在）
  3. 使用 edit_file 更新 .brain/milestones.md，将目标里程碑从 [Active] 改为 [Completed]
  4. 使用 read_file 二次验证 milestones.md，确认状态更新成功
验证：二次读取 milestones.md 确认状态为 [Completed]，且交付物文件内容完整
