# 里程碑状态同步与验证（历史记录已存在但 milestones.md 状态未更新）

> category: file | id: s-7affcf | 2026-03-06T09:15:23.746Z

场景：里程碑状态同步与验证（历史记录已存在但 milestones.md 状态未更新）
步骤：
1. 读取 knowledge.md 获取历史完成记录
2. 读取 milestones.md 检查当前状态
3. 读取相关核心文件验证内容完整性
4. 使用 edit_file 同步状态（[Active] → [Completed]）
5. 二次读取 milestones.md 验证更新成功
验证：二次读取确认状态已更新，且未重复调用扫描工具
