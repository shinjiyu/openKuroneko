# 目录结构扫描里程碑（M1），需在已有知识基线的情况下快速验证并更新状态

> category: file | id: s-ced2cf | 2026-03-06T09:15:23.749Z

场景：目录结构扫描里程碑（M1），需在已有知识基线的情况下快速验证并更新状态

步骤：
1. 读取 .brain/knowledge.md 获取历史项目事实（避免重复扫描）
2. 执行 `find . -maxdepth 2 -type f -o -type d | sort` 最小化验证当前目录结构
3. 对比历史记录与实际扫描结果，确认一致性
4. 使用 edit_file 更新 milestones.md 状态（[Active] → [Completed]）
5. 二次读取 milestones.md 验证状态同步成功

验证：milestones.md 中目标里程碑状态为 [Completed]，且目录结构与 knowledge.md 历史记录一致
