# 需要验证和完成目录结构扫描类里程碑（如 M1）

> category: file | id: s-bbbcfd | 2026-03-06T09:15:23.750Z

场景：需要验证和完成目录结构扫描类里程碑（如 M1）

步骤：
1. read_file(.brain/knowledge.md) - 获取历史知识基线，避免重复扫描
2. shell_exec(find 命令) - 最小化验证目录结构是否发生变化
3. edit_file(.brain/milestones.md) - 显式更新里程碑状态（[Active] → [Completed]）
4. read_file(.brain/milestones.md) - 二次验证状态更新成功

验证：
- knowledge.md 包含足够的历史事实（≥50 条）作为基线
- find 输出与历史记录一致
- milestones.md 状态已从 [Active] 变为 [Completed]
- 整个流程无重复文件扫描操作
