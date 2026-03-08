# 风险评估与系统稳定性验证标准流程

> category: agent | id: skill-c766 | 2026-03-07T15:47:20.091Z

场景：需要验证 Agent 的探索行为或操作是否会影响系统稳定运行，特别是在进行自我复制、资源导出等潜在风险操作后

步骤：
  1. 读取之前的探索报告（architecture-boundary-exploration-report.md, system-capability-audit-report.md, replication-feasibility-final-report.md），了解已知的边界和能力
  2. 检查 .brain/controller-state.json 确认系统当前状态（mode: EXECUTE/REPLAN/BLOCK）
  3. 检查进程状态（ps aux | grep agent）和资源使用（内存、CPU、运行时间）
  4. 执行并发安全测试（后台并发创建多个文件，验证无竞争条件）
  5. 执行大文件操作测试（创建10MB临时文件，验证资源消耗和清理）
  6. 执行后台任务测试（启动后台进程，验证主进程不受影响）
  7. 验证框架保护（检查 .brain/ 目录完整性，确认框架文件未损坏）
  8. 执行 Shell 边界测试（测试文件系统访问限制）
  9. 执行压力测试（创建100个文件并删除，验证高频操作安全性）
  10. 检查网络操作安全性（HTTP 请求测试）
  11. 检查系统关键服务（Agent 进程、端口、临时目录）
  12. 生成风险评估报告，包含测试结果、风险等级评估、改进建议

验证：
  - 所有测试项目均通过（✅）
  - 无高风险项（红色）
  - Agent 进程状态正常（SN 状态，内存/CPU 使用合理）
  - .brain/ 目录文件完整
  - 测试文件已清理，无资源残留
  - 生成完整的风险评估报告（包含风险等级矩阵和系统稳定性评分）
