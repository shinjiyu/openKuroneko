# 需要验证并完成里程碑任务（如目录扫描、文件读取、文档生成等）

> category: file | id: s-ffa9cd | 2026-03-06T09:15:23.759Z

场景：需要验证并完成里程碑任务（如目录扫描、文件读取、文档生成等）

步骤：
1. 读取 knowledge.md 历史记录，了解已完成的工作和项目事实基线
2. 执行实际验证操作（如 find 扫描目录、read_file 验证文件内容）
3. 使用 edit_file 显式更新 milestones.md 状态（[Active] → [Completed]）
4. 使用 read_file 二次验证 milestones.md 确认更新成功

验证：里程碑状态成功从 [Active] 更新为 [Completed]，二次读取确认更新持久化
