# 需要扫描目录结构并建立项目骨架与层级关系

> category: file | id: s-a94aaa | 2026-03-06T09:15:23.741Z

场景：需要扫描目录结构并建立项目骨架与层级关系

步骤：
1. 使用 `find . -maxdepth 3 -type d | sort` 列出目录结构
2. 使用 `find . -maxdepth 3 -type f | sort` 列出文件清单
3. 读取或创建 project-structure.md，整理为目录树格式
4. 绘制层级关系图（使用缩进和符号表示父子关系）
5. 制作文件统计表（类型、数量、文件列表）
6. 将关键事实记录到 knowledge.md（如"包含 X 个文件、Y 个目录"）

验证：
- project-structure.md 包含完整的目录树、文件统计表、层级关系图
- knowledge.md 记录了"目录结构已完整扫描"的事实
- 无遗漏文件或目录
