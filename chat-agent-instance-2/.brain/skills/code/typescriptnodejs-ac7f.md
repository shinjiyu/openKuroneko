# 探索 TypeScript/Node.js 项目架构的标准方法

> category: code | id: typescriptnodejs-ac7f | 2026-03-07T16:25:34.835Z

场景：需要快速理解一个 TypeScript/Node.js 项目的整体架构、核心模块和运行机制，尤其是当 agent 工作目录是项目子目录时。

步骤：
  1. 确认真实项目根目录（pwd + ls -la，若当前目录缺少源码则 cd .. 探索父目录）
  2. 读取 package.json 获取项目名称、描述、依赖、脚本和入口文件信息
  3. 使用 tree -L 3 或 find 探索目录结构（排除 node_modules/dist）
  4. 定位核心模块：查找 src/ 目录，关注 cli/（入口）、controller/（核心逻辑）、adapter/（外部接口）、tools/（能力扩展）
  5. 读取关键源码文件：CLI 入口（参数解析和组装）、核心控制器（状态机和循环逻辑）、brain/（状态管理）
  6. 查阅 doc/ 或 docs/ 目录下的设计文档和协议定义（如有）
  7. 整理架构发现并记录到 knowledge.md（模块职责 + 通信机制 + 关键文件路径）

验证：能够用一句话描述项目的核心运行机制，并列出 3 个以上关键模块及其职责。
