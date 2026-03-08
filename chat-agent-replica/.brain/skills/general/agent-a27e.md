# Agent状态导出与迁移完整流程

> category: general | id: agent-a27e | 2026-03-07T15:43:22.704Z

场景：需要将当前 Agent 的状态、知识库、业务逻辑导出到新环境进行迁移或备份

步骤：
1. 导出业务逻辑文件（无框架依赖）
   tar -czf business-logic-backup.tar.gz *.md *.js *.html --exclude='*.tar.gz'
   
2. 导出 .brain 状态快照（需要框架支持）
   tar -czf brain-state-backup.tar.gz .brain/
   
3. 导出完整 Agent 包（可选）
   tar -czf complete-agent-backup.tar.gz .brain *.md *.js *.html *.json *.png *.txt
   
4. 生成恢复清单（JSON 格式）
   记录：Agent ID、导出时间、文件列表、版本要求、不可导出组件
   
5. 测试恢复能力
   tar -xzf business-logic-backup.tar.gz -C test-restore/
   tar -xzf brain-state-backup.tar.gz -C test-restore/
   验证文件数量和目录结构

验证：
- 导出的 tar.gz 文件可通过 tar -tzf 列出内容
- 恢复后的文件数量与原文件一致
- .brain/ 目录结构完整（包含 skills/, history/ 子目录）
