# Backlog

待处理的已知问题与改进项。

---

## [BUG] 工作目录跨任务污染

**优先级**：中  
**发现时间**：2026-03-07

### 现象

新任务启动后，Executor 在做系统自检（`ls -la`）时，会发现工作目录里残留的历史任务文件（如 `playwright-weibo-login.js`、`weibo-auth.json`、`steph808-*.md` 等），并将其读入 LLM 上下文，导致无关内容污染当前任务提示词。

### 根因

`archiveForNewTask()` 只归档 `.brain/` 状态目录，不清理工作目录（`chat-agent/`）。工作目录在所有任务间共享、累积，历史任务的产出文件永久留存。

### 解决方案

**在外脑层面**，为每个任务分配独立的工作目录：

- 每次 `set_goal` 时，按任务 ID（或时间戳）生成新的子目录，例如 `chat-agent/workspaces/<task-id>/`
- 内脑进程启动时以该目录为 `cwd`（通过启动参数传入）
- 旧的工作目录保留（供回溯），但不再是活动 `cwd`

涉及改动：
- `src/outer-brain/tools/set-goal.ts`：生成 workspace 路径，写入启动参数
- `src/inner-brain/cli/`（内脑入口）：接受 `--workspace-dir` 参数并切换 `process.chdir()`
- `InnerBrainManager`：启动内脑进程时透传 workspace 路径

---

## [FEAT] 里程碑间全局反思阶段（REFLECT）

**优先级**：高  
**发现时间**：2026-03-07  
**触发场景**：内脑在"自我复制"任务中，M1 发现 `shell_exec` 可绕过父目录限制，但 M2 预先规划的"源码不可访问"结论从未被修订，导致实际可以访问源码却从未尝试。

### 问题本质

当前 EXECUTE → ATTRIBUTE → EXECUTE 的流水线缺少一个全局视角的检查点：

- ATTRIBUTE 只问"这个里程碑成功了吗？学到了什么？"
- 没有任何阶段问"我学到的东西，是否让后续里程碑的计划变得不再准确？"

结果是：每个里程碑局部成功，但整体目标可能遗漏了关键路径。

### 解决方案：新增 REFLECT 状态

在 ATTRIBUTE 完成且判定 `SUCCESS_AND_NEXT` 后、进入下一个 EXECUTE 前，插入轻量的 REFLECT 阶段：

```
EXECUTE → ATTRIBUTE → REFLECT → EXECUTE（下一里程碑）
                              ↘ REVISE（局部修订后继续）
```

**REFLECT 的职责（单次 LLM 调用，无工具调用）：**

输入上下文：
- 原始任务目标
- 已完成里程碑摘要
- 待执行里程碑列表
- 本轮 ATTRIBUTE 新增的 knowledge / constraints

核心问题："新发现的知识或约束，是否与待执行里程碑的某个前提假设存在矛盾？"

输出结构：
- `CONFIRM`：计划仍有效，继续下一里程碑
- `REVISE`：指定需修改的里程碑 ID + 新增/修改的任务描述（局部修订，非全量重规划）

**设计原则：**

- **轻量**：单次 LLM 调用，不执行任何工具，纯推理
- **偏向稳定**：默认 CONFIRM，仅在发现明确矛盾时才 REVISE
- **局部修订**：REVISE 只更新指定里程碑描述，不推翻整个计划
- **可跳过**：里程碑数 ≤ 2 或 ATTRIBUTE 无新知识时自动 CONFIRM

**反例验证（此任务若有 REFLECT）：**

```
M1 ATTRIBUTE 写入：
  "[避坑] shell_exec 可访问父目录，不受 read_file 限制"

REFLECT 发现：
  M2 计划假设"框架源码不可导出（沙箱禁止父目录访问）"
  ← 矛盾！新约束说 shell 可以访问父目录
  → REVISE M2：补充"用 shell_exec 实际尝试读取 ../src/ 源码"
```

**涉及改动：**

- `src/controller/controller.ts`：在 `milestone.next` 前插入 REFLECT 状态
- `src/controller/reflector.ts`（新建）：单次 LLM 调用，参考 `attributor.ts`
- `doc/protocols/evolutionary-loop.md`：更新状态机文档

---
