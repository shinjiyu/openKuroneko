# 里程碑状态验证与同步（M1 目录扫描类任务）

> category: file | id: s-89afdc | 2026-03-06T09:15:23.758Z

场景：里程碑状态验证与同步（M1 目录扫描类任务）

步骤：
1. 读取 knowledge.md 历史记录，确认目录结构、文件存在性和历史完成情况
2. 读取 milestones.md 当前状态，识别需要验证的里程碑
3. 使用 find 命令最小化扫描验证目录结构未变
4. 使用 edit_file 同步里程碑状态（[Active] → [Completed]）
5. 使用 read_file 二次验证状态更新成功

验证：
- milestones.md 中目标里程碑状态为 [Completed]
- 目录结构与历史记录一致
- knowledge.md 新增本次完成记录
