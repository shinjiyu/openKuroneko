# 需要验证并完成里程碑任务（如 M1 目录扫描、M2 文件读取、M3 文档生成等）

> category: file | id: s-f5fd62 | 2026-03-06T09:15:23.759Z

场景：需要验证并完成里程碑任务（如 M1 目录扫描、M2 文件读取、M3 文档生成等）

步骤：
1. 读取 knowledge.md 历史记录，确认已完成事项和项目事实基线
2. 执行最小化实际验证（如 find 扫描、read_file 验证文件存在性和完整性）
3. 调用 edit_file 更新 milestones.md，将目标里程碑状态从 [Active] 改为 [Completed]
4. 调用 read_file 二次验证 milestones.md，确认状态更新成功

验证：
- milestones.md 文件大小应增加 3 bytes（"[Active]" → "[Completed]" 增加 5 个字符，删除 2 个字符）
- 二次读取 milestones.md 应显示目标里程碑状态为 [Completed]
- 执行过程应零冗余（不重复扫描已知结构，不重复读取已验证文件）
