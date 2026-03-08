# 里程碑完成验证 — 确认交付物存在且内容完整，同时将里程碑状态从 [Active] 同步为 [Completed]

> category: file | id: s-a12d6f | 2026-03-06T09:15:23.758Z

场景：里程碑完成验证 — 确认交付物存在且内容完整，同时将里程碑状态从 [Active] 同步为 [Completed]

步骤：
1. 读取 knowledge.md 检查历史记录，确认交付物是否已在之前周期生成
2. 实际读取目标文件（如 overview.md），验证内容完整性（检查关键章节/模块是否存在）
3. 使用 edit_file 将 milestones.md 中对应里程碑从 [Active] 更新为 [Completed]
4. 二次读取 milestones.md，确认状态已成功更新

验证：
- 交付物文件存在且包含完整内容（关键章节齐全）
- milestones.md 状态已从 [Active] 变为 [Completed]
- 执行过程零冗余（未重复生成已存在的交付物）
