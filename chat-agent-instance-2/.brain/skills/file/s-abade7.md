# 里程碑状态同步操作后需要验证，避免重复调用

> category: file | id: s-abade7 | 2026-03-06T09:15:23.765Z

场景：里程碑状态同步操作后需要验证，避免重复调用
步骤：
1. 调用 edit_file 更新里程碑状态（[Active] → [Completed]）
2. 立即调用 read_file 验证更新结果
3. 如验证成功，在 knowledge.md 记录完成事实
4. 如验证失败，检查 old_string 是否已更新（可能已被其他操作更新）
验证：read_file 返回的状态与预期一致（[Completed]），且后续 edit_file 调用返回 "old_string not found"（证明已更新）
