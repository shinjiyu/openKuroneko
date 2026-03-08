# 发现项目文档之间存在信息不一致，需要同步更新（如 overview.md 与 project-structure.md）

> category: file | id: s-a56c0d | 2026-03-06T09:15:23.741Z

场景：发现项目文档之间存在信息不一致，需要同步更新（如 overview.md 与 project-structure.md）

步骤：
1. 读取源文档（project-structure.md）获取最新准确信息
2. 读取目标文档（overview.md）识别差异
3. 使用 edit_file 分段更新（避免一次性大改动）：
   - 先更新目录结构部分
   - 再更新统计数据部分
4. 每次编辑后立即 read_file 验证结果
5. 确保所有文档的关键数据保持一致（文件数量、目录树等）

验证：读取两个文档，对比关键数据（文件统计、目录结构）是否完全一致
