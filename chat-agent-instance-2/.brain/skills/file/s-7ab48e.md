# 需要扫描并分析项目目录结构，建立层级关系文档

> category: file | id: s-7ab48e | 2026-03-06T09:15:23.740Z

场景：需要扫描并分析项目目录结构，建立层级关系文档

步骤：
1. 使用 `find . -maxdepth 3 -type d | sort` 列出目录层级
2. 使用 `find . -maxdepth 3 -type f | sort` 列出文件清单
3. 使用 `find . -type f -o -type d | head -100` 获取完整路径列表
4. 读取已有的 project-structure.md 确认现有文档状态
5. 读取 .brain/knowledge.md 确认知识库记录
6. 根据扫描结果更新或创建结构分析文档（包含目录树、文件统计表、层级关系图）

验证：
- 文档包含完整的目录树可视化（使用 ASCII 树形图）
- 文档包含文件统计表（类型/数量/说明）
- 文档包含层级关系说明（至少 3 层）
- knowledge.md 中记录了关键事实
