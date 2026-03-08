# 验证已完成的里程碑交付物（如 overview.md）的存在性和内容完整性

> category: file | id: s-aa61ae | 2026-03-06T09:15:23.754Z

场景：验证已完成的里程碑交付物（如 overview.md）的存在性和内容完整性
步骤：
  1. 读取 knowledge.md 检查历史记录，确认交付物是否已在之前周期生成
  2. 读取实际交付物文件（如 overview.md），验证内容完整性（检查必需模块/章节是否齐全）
  3. 读取 milestones.md 检查当前里程碑状态
  4. 调用 edit_file 显式同步里程碑状态（[Active] → [Completed]）
  5. 再次读取 milestones.md 二次验证状态更新成功
验证：二次读取确认 milestones.md 状态已更新为 [Completed]，交付物文件包含所有必需内容
