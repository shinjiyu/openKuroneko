# 里程碑状态不一致（knowledge.md 记录完成但 milestones.md 仍为 Active）

> category: file | id: s-d9ddeb | 2026-03-06T09:15:23.749Z

场景：里程碑状态不一致（knowledge.md 记录完成但 milestones.md 仍为 Active）
步骤：
1. 读取 knowledge.md 检查历史完成记录（时间戳 + 完成状态）
2. 执行最小化验证操作（如 find 扫描、文件读取）确认实际状态
3. 调用 edit_file 同步 milestones.md 状态（[Active] → [Completed]）
4. 二次读取 milestones.md 验证状态更新成功
验证：milestones.md 中对应里程碑状态为 [Completed]，且与 knowledge.md 记录一致
