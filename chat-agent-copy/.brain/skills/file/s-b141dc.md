# 里程碑要求读取关键文件内容，需避免重复读取已完成的工作

> category: file | id: s-b141dc | 2026-03-06T09:15:23.748Z

场景：里程碑要求读取关键文件内容，需避免重复读取已完成的工作
步骤：
  1. 读取 .brain/knowledge.md 获取历史事实和已完成的里程碑记录
  2. 根据历史记录识别需要读取的核心文件列表
  3. 逐个读取核心文件（overview.md、project-structure.md、snake.html 等）
  4. 使用 edit_file 更新 .brain/milestones.md 状态（[Active] → [Completed]）
  5. 二次读取 .brain/milestones.md 验证状态更新成功
验证：二次读取 milestones.md 确认目标里程碑状态已变为 [Completed]，且读取过程中未重复扫描已知文件
