# 需要验证工作目录中是否存在特定主题或实体的数据文件

> category: file | id: s-6b82be | 2026-03-06T09:15:23.764Z

场景：需要验证工作目录中是否存在特定主题或实体的数据文件
步骤：
  1. 使用 find 命令搜索文件名包含关键字的文件：find . -type f -name "*keyword*" 
  2. 使用 grep 递归搜索文件内容包含关键字的文件：grep -r "keyword" . --include="*.md" --include="*.json" --include="*.txt"
  3. 分析搜索结果，确认数据源存在性
  4. 如果不存在，明确记录并评估后续里程碑的可行性
  5. 更新里程碑状态并记录到 knowledge.md
验证：通过搜索命令的输出结果确认数据源的存在性，knowledge.md 中有明确的记录
