# 需要扫描项目目录结构以获取整体布局

> category: file | id: s-cd88c6 | 2026-03-06T09:15:23.762Z

场景：需要扫描项目目录结构以获取整体布局
步骤：
  1. 使用 `find . -maxdepth 3 -type f -o -type d | sort` 命令扫描目录
  2. 将扫描结果记录到 project-structure.md 文件
  3. 更新里程碑状态为 [Completed]
  4. 验证状态更新成功
验证：find 命令返回完整文件树，且里程碑状态已更新为 [Completed]
