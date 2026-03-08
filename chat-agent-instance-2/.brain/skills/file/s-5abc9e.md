# 里程碑前置条件验证，需要确认历史任务（目录扫描、文件读取）是否已完成，避免重复扫描

> category: file | id: s-5abc9e | 2026-03-06T09:15:23.757Z

场景：里程碑前置条件验证，需要确认历史任务（目录扫描、文件读取）是否已完成，避免重复扫描
步骤：
1. 读取 .brain/knowledge.md 获取历史事实基线（项目结构、核心文件内容、历史里程碑完成记录）
2. 读取 .brain/milestones.md 确认当前里程碑状态
3. 使用 edit_file 同步状态（[Active] → [Completed]）
4. 使用 read_file 二次验证状态更新成功
验证：milestones.md 中目标里程碑状态已从 [Active] 更新为 [Completed]，且 knowledge.md 历史记录显示前置任务已完成
