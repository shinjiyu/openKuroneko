# 极简项目里程碑完成验证（单个里程碑）

> category: file | id: s-53dab1 | 2026-03-06T09:15:23.759Z

场景：极简项目里程碑完成验证（单个里程碑）

步骤：
1. 读取 knowledge.md（检查历史事实基线）
2. 读取 milestones.md（确认当前里程碑状态）
3. 读取目标里程碑交付物（验证文件存在性和内容完整性）
4. edit_file 更新里程碑状态（[Active] → [Completed]）
5. read_file 二次验证（确认状态更新成功）

验证：二次读取 milestones.md 确认目标里程碑状态已从 [Active] 变更为 [Completed]，交付物文件内容完整且有效
