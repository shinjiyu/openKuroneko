# 极简项目里程碑快速验证（M1 目录扫描/状态同步）

> category: file | id: s-4fa1c8 | 2026-03-06T09:15:23.759Z

场景：极简项目里程碑快速验证（M1 目录扫描/状态同步）
步骤：
  1. 读取 knowledge.md 历史记录（确认已有事实基线）
  2. 使用 find 扫描目录结构（验证结构未变，最小化调用）
  3. 使用 edit_file 同步里程碑状态（[Active] → [Completed]）
  4. 使用 read_file 二次验证状态更新成功
验证：read_file(milestones.md) 确认状态已同步，执行耗时约 30-40 秒
