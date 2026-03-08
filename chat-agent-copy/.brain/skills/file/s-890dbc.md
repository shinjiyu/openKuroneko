# 执行"读取关键文件内容"类里程碑，需要理解项目逻辑但避免重复扫描

> category: file | id: s-890dbc | 2026-03-06T09:15:23.747Z

场景：执行"读取关键文件内容"类里程碑，需要理解项目逻辑但避免重复扫描

步骤：
1. 读取 knowledge.md 获取历史事实基线，识别已掌握信息和待读取文件
2. 读取 milestones.md 确认当前里程碑状态
3. 根据历史记录识别核心文件清单（如 overview.md、project-structure.md、核心应用代码）
4. 逐个读取核心文件，理解项目结构和业务逻辑
5. 更新 milestones.md 状态（[Active] → [Completed]）
6. 二次验证状态更新成功（read_file 确认）

验证：里程碑状态已同步为 [Completed]，且通过二次读取确认；knowledge.md 可记录新发现的项目事实
