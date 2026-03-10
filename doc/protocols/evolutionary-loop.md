# Pi-mono 演化循环协议

**名称**：Pi-mono Evolutionary Loop Protocol  
**版本**：v1.0  
**日期**：2026-03-05

---

## 1. 核心哲学

### 1.1 双脑解耦

**外脑**负责「人机对话与战略定义」：与人交互，写入目标（`goal.md`），在 Agent 卡死时提供干预。

**内脑**负责「环境演化与目标死磕」：不与人直接对话，只读取文件，在三种思维模式之间切换，自主推进目标直到完成或请求外脑介入。

两者通过 `.brain/` 文件系统解耦，不共享内存对话。

### 1.2 文件即真相（File-as-State）

不依赖进程内存表示状态。所有认知、约束、计划均持久化为 Markdown 文件。进程重启、环境切换后，内脑从文件重建完整上下文，无需人工干预。

### 1.3 归因驱动

每次执行序列结束后，无论成功还是失败，**强制**进行归因分析。  
失败经验被蒸馏为「红线约束」写入 `constraints.md`，成功经验被蒸馏为「可复用技能」写入 `skills.md`。下一次执行从这些蒸馏结果出发，而不是重演错误。

### 1.4 战略恒定，战术演化

**Goal**（最终目标）由外脑设定，内脑不可修改。  
**Milestones**（里程碑计划）由内脑根据执行结果和归因结论动态重构——完成时标记，撞墙时重排。

---

## 2. `.brain/` 文件系统

内脑在工作时挂载并维护以下六个文件，统一存放于 Agent 工作目录下的 `.brain/` 子目录：

| 文件 | 层级 | 核心内容 | 读写权限 |
|------|------|----------|----------|
| `goal.md` | 战略 | 最终目标、成功标准、执行风格参数 | 外脑写，内脑只读 |
| `milestones.md` | 战术 | 3–5 个高层锚点任务，标记 Pending / Active / Completed | 内脑读写（Decomposer） |
| `constraints.md` | 约束 | 归因生成的红线禁令（永久）与避坑指南（临时） | 内脑读写（Attributor 写；Decomposer/Executor 读） |
| `knowledge.md` | 事实 | 演化出的环境事实（如 API 行为、项目结构规律） | 内脑读写（Attributor 写；Executor 读） |
| `skills.md` | 技能 | 成功操作的可复用模式（场景 / 步骤 / 验证） | 内脑读写（Attributor 写；Executor 读） |
| `environment.md` | 现状 | 当前快照描述、报错信息、已获得的临时凭证 | 框架更新，内脑只读 |

### 里程碑格式约定

```
[M1] [Active]    <里程碑标题> — <一句话说明>
[M2] [Pending]   <里程碑标题> — <一句话说明>
[M3] [Completed] <里程碑标题> — <一句话说明>
```

- 同一时刻只有 **一个** Active 里程碑
- 里程碑描述停留在「做什么」层次，不包含具体命令或参数

---

## 3. 三种思维模式

控制器在三种 LLM 调用模式之间切换。每种模式有固定的输入来源、工具集和输出格式。

### 3.1 模式 A：战术拆解（Decomposer）

**触发条件**：初次启动，或 Attributor 输出 `REPLAN` / `SUCCESS_AND_NEXT`（且仍有 Pending 里程碑需要重新规划）。

**输入（控制器拼装为 user message）**：

```
## Goal
<goal.md 全文>

---
## Constraints
<constraints.md 全文，或 "暂无约束">

---
## Current Milestones（重规划时参考，初次为空）
<milestones.md 全文，或 "尚无里程碑">

---
## Reason
<"初次规划" 或 "REPLAN: <Attributor 给出的原因>">
```

**System Prompt**：

```
你是一个战术拆解器（Tactical Decomposer）。你的唯一职责是：
根据目标和约束，制定一个 3-5 条里程碑的行动计划。

输出规则：
- 输出内容将直接写入 milestones.md，不要有任何额外解释
- 格式严格遵守：
    [M1] [Active]  <里程碑标题> — <一句话说明>
    [M2] [Pending] <里程碑标题> — <一句话说明>
- 第一个可执行里程碑标记为 Active，其余为 Pending
- 里程碑描述停留在「做什么」层次，不涉及具体命令、参数、文件名
- 必须遵守 Constraints 里的所有红线禁令，不得规划违反红线的里程碑
- 重规划时可借鉴旧里程碑，但必须整体重写，不能只改一条
```

**工具**：无（`tools=[]`）

**输出处理**：控制器将 `result.content` 全文直接写入 `.brain/milestones.md`，不经过工具调用。

---

### 3.2 模式 B：反应执行（Executor）

**触发条件**：Decomposer 完成后，或 Attributor 输出 `CONTINUE`。

**输入（每次从文件重建，无任何执行历史）**：

```
## 当前任务（Active Milestone）
<milestones.md 中第一个 [Active] 条目全文>

---
## 约束（必须严格遵守）
<constraints.md 全文，或 "暂无约束">

---
## 当前环境
<environment.md 全文，或 "暂无环境信息">

---
## 知识库（环境事实）
<knowledge.md 全文，或 "暂无已知事实">

---
## 技能库（可复用操作模式，渐进式披露）
与当前里程碑相关的技能**仅先给出索引**（id、category、title、tags）。需要某条技能的完整内容与操作步骤时，调用工具 **get_skill_content(skill_id)** 获取。若暂无本地技能，可调用 **query_available_skills** 查询外部技能库。详见 [技能渐进式披露设计](../designs/skills-progressive-disclosure.md)。

---
## 工作目录
<workDir 绝对路径>

请使用工具对当前里程碑执行操作。
```

**System Prompt**：

```
你是一个反应执行器（Reactive Executor）。你的唯一职责是：
专注完成当前 Active 里程碑，通过工具调用推进目标。

执行规则：
- 只做「当前 Active 里程碑」要求的事，不碰其他里程碑
- 严格遵守 Constraints 里的所有约束，红线绝对不可越
- 技能库首轮仅提供索引；需要某条技能的完整步骤时，调用 get_skill_content(skill_id) 获取（渐进式披露）
- 优先参考已获取的技能内容与约束，避免重复探索
- 文件路径使用相对路径（相对于工作目录）
- 不要直接修改 .brain/ 目录下的文件（由框架管理）
- 当你认为本次执行循环做得差不多了，停止调用工具
- 归因由框架强制执行，你不需要自我评估是否完成
```

**工具**：全套标准工具

| 工具 | 说明 |
|------|------|
| `read_file` | 读取工作目录内文件 |
| `write_file` | 写入工作目录内文件 |
| `edit_file` | 局部编辑文件 |
| `shell_exec` | 执行 shell 命令 |
| `web_search` | 搜索外部信息 |
| `get_time` | 获取当前时间 |
| `seek_context` | 检索归档上下文 |
| `get_skill_content` | 按 skill_id 获取单条技能的完整内容（渐进式披露按需加载） |
| `query_available_skills` | 按 query 查询外部技能库，返回匹配技能的摘要/全文 |

**输出处理**：控制器执行多轮工具调用直到 LLM 停止返回 tool calls，记录完整 `executionLog`（含 preState 快照和 postState 快照），然后强制进入 Attributor。

---

### 3.3 模式 C：强制归因（Attributor）

**触发条件**：Executor 工具循环结束，或执行中遇到报错中断。归因是**强制**的，不可跳过。

**输入（控制器拼装为 user message）**：

```
## 目标里程碑
<当前 Active 里程碑全文>

---
## 执行前状态（Pre-State）
### environment.md（执行前快照）
<preState.environment>

### 里程碑状态（执行前）
<Active 里程碑执行前的状态描述>

---
## 执行日志
### 操作 1
工具：<tool_name>
参数：<args JSON>
结果：<result JSON>

### 操作 2
...

---
## 执行后状态（Post-State）
### environment.md（执行后快照）
<postState.environment>

---
## 错误摘要（如有）
<执行期间发生的错误列表>
```

**System Prompt**：

```
你是一个强制归因器（Mandatory Attributor）。每次执行结束后，
你必须按顺序完成以下五项任务：

【任务 1 — 归因分析】（内部推理）
分析执行日志，找出「进展/停滞/成功/失败」的根本原因。

【任务 2 — 约束提取】（可选，失败时优先）
如果发现了应该永久避免的操作模式，调用 write_constraint 工具。
格式："[红线] <禁止行为> — <原因>"
      "[避坑] <注意事项> — <适用场景>"

【任务 3 — 技能提取】（可选，SUCCESS_AND_NEXT 时优先）
如果本次执行中有「解决了某类问题」的可复用模式，调用 write_skill 工具。
格式：
  场景：<遇到什么情况>
  步骤：<有效的操作序列，按序列出>
  验证：<如何确认成功>

【任务 4 — 知识提取】（可选）
如果发现了关于环境/项目的新客观事实，调用 write_knowledge 工具。
格式："[事实] <内容>"

【任务 5 — 控制决策】（必做，最后输出）
最后两行必须是：
CONTROL: <CONTINUE|SUCCESS_AND_NEXT|REPLAN|BLOCK>
REASON: <一句话说明原因>

判断标准：
- CONTINUE：有实质进展但里程碑未完成，继续执行
- SUCCESS_AND_NEXT：里程碑目标已达成
- REPLAN：遇到根本性障碍，当前计划不可行，需要重新规划
- BLOCK：无法独立解决，需要外脑或人类介入

硬性规则（优先于其他判断）：
- 执行日志为空（没有任何工具调用）→ 必须 REPLAN
- 连续两次完全相同的工具调用均失败 → 必须 REPLAN
- 无法判断是否有进展 → 倾向 REPLAN，而非 CONTINUE
```

**工具**：仅三个专用工具

| 工具 | 写入目标 | 调用时机 |
|------|----------|----------|
| `write_constraint` | `.brain/constraints.md`（追加） | 发现红线或避坑 |
| `write_skill` | `.brain/skills.md`（追加） | 发现可复用成功模式 |
| `write_knowledge` | `.brain/knowledge.md`（追加） | 发现新环境事实 |

**输出处理**：控制器从 `result.content` 末尾用正则提取 `CONTROL: <FLAG>` 和 `REASON: <...>`。无法解析时默认 `REPLAN`（保守策略）。

---

## 4. 执行记忆蒸馏原则

### 4.1 临时状态与持久状态

| 类型 | 载体 | 生命周期 | 内容 |
|------|------|----------|------|
| **执行记忆** | `executionLog`（Message[]） | 一次执行周期，Attributor 读完即丢弃 | 原始工具调用序列、报错堆栈、中间结果 |
| **蒸馏记忆** | `.brain/` 文件 | 永久持久化，跨 session | 归因后的红线、技能范式、环境事实 |

### 4.2 错误归因后的执行器重置

当 Attributor 输出 `CONTINUE` 或 `REPLAN` 后：

- `executionLog` 被完全丢弃，不传入下一次 Executor
- 下一次 Executor 以「纯白板 + .brain/ 文件」启动
- Executor 对上一次的失败无记忆，但 `constraints.md` 已包含归因后的红线

**设计意图**：防止 LLM 被历史失败路径「锚定」，以全新视角重新审视问题，同时通过约束文件保留蒸馏后的教训。

### 4.3 知识积累路径

```
执行失败 → Attributor → write_constraint → constraints.md
                      → write_knowledge → knowledge.md

执行成功 → Attributor → write_skill     → skills.md
                      → write_knowledge → knowledge.md

下次执行 → Executor 读取 constraints + knowledge + skills → 以蒸馏后的智慧执行
```

---

## 5. 控制器状态机

### 5.1 Control Flags

| Flag | 含义 | 控制器下一步 |
|------|------|-------------|
| `CONTINUE` | 有进展，里程碑未完成 | → EXECUTE（新 executionLog，无历史） |
| `SUCCESS_AND_NEXT` | 当前里程碑完成 | 更新 milestones.md（标 Completed）→ 若有 Pending → EXECUTE 下一个；否则 → 写 COMPLETE 报告 |
| `REPLAN` | 根本性障碍，计划不可行 | → DECOMPOSE（将 REASON 作为 REPLAN 原因传入） |
| `BLOCK` | 需外部介入 | 写 `[BLOCK]` 到 output → 暂停循环，等待 input → 视 input 内容决定 REPLAN 或 CONTINUE |

### 5.2 主循环伪码

```
controllerState = {
  mode: 'DECOMPOSE',      // 初次启动从 DECOMPOSE 开始
  replanReason: null,
  preState: null,
  executionLog: [],
}

loop:
  switch controllerState.mode:

    case 'DECOMPOSE':
      context = buildDecomposeContext(
        read('.brain/goal.md'),
        read('.brain/constraints.md'),
        read('.brain/milestones.md'),
        controllerState.replanReason,
      )
      result = llm.chat(DECOMPOSE_SYSTEM, context, tools=[])
      write('.brain/milestones.md', result.content)   // 控制器直接写，不通过工具
      controllerState.mode = 'EXECUTE'
      controllerState.replanReason = null

    case 'EXECUTE':
      executionLog = []                                // 每次清空，无历史
      activeMilestone = parseMilestones('.brain/milestones.md').findActive()
      if not activeMilestone:
        writeOutput('[COMPLETE] 所有里程碑已完成。')
        exit loop

      controllerState.preState = snapshot()            // 执行前快照
      context = buildExecutorContext(activeMilestone, ...)  // 纯从 .brain/ 文件读

      // 多轮工具调用循环
      currentMessages = [context]
      loop:
        result = llm.chat(EXECUTOR_SYSTEM, currentMessages, tools=ALL_TOOLS)
        if not result.toolCalls: break
        for each toolCall in result.toolCalls:
          toolResult = tool.execute(toolCall)
          executionLog.push({ toolCall, toolResult })
          currentMessages.append(toolCall, toolResult)

      controllerState.postState = snapshot()           // 执行后快照
      controllerState.executionLog = executionLog
      controllerState.mode = 'ATTRIBUTE'

    case 'ATTRIBUTE':
      context = buildAttributorContext(
        activeMilestone,
        controllerState.preState,
        controllerState.executionLog,    // 传给 Attributor 后即丢弃
        controllerState.postState,
      )
      result = llm.chat(ATTRIBUTOR_SYSTEM, context, tools=[WRITE_CONSTRAINT, WRITE_SKILL, WRITE_KNOWLEDGE])
      flag, reason = parseControlFlag(result.content)

      controllerState.executionLog = []                // 丢弃执行记忆

      switch flag:
        'CONTINUE':
          controllerState.mode = 'EXECUTE'             // 下次 Executor 无历史感知

        'SUCCESS_AND_NEXT':
          markMilestoneCompleted('.brain/milestones.md', activeMilestone)
          next = parseMilestones('.brain/milestones.md').findNextPending()
          if next:
            activateNextMilestone('.brain/milestones.md', next)
            controllerState.mode = 'EXECUTE'
          else:
            writeOutput('[COMPLETE] ' + generateCompletionReport())
            exit loop

        'REPLAN':
          controllerState.replanReason = reason
          controllerState.mode = 'DECOMPOSE'

        'BLOCK':
          writeOutput('[BLOCK] ' + reason)
          controllerState.mode = 'BLOCKED'

    case 'BLOCKED':
      input = readInput()
      if input:
        // 外脑提供了响应，触发重规划
        controllerState.replanReason = 'BLOCK 已解除，外脑指示：' + input
        controllerState.mode = 'DECOMPOSE'
      else:
        // 继续等待，调度器退避
        return { hadWork: false }
```

### 5.3 空转与退避

- 无 Active 里程碑且无 input → 返回 `hadWork: false` → 调度器指数退避
- BLOCKED 状态且无 input → 同上
- 有工作（任何模式的 LLM 调用或工具执行）→ 返回 `hadWork: true` → 调度器立即继续

---

## 6. 参与方

| 角色 | 职责 |
|------|------|
| **外脑（External Brain）** | 写 `goal.md`；在 BLOCK 时通过 input 提供响应；读取 output 的 BLOCK 请求和 COMPLETE 报告 |
| **控制器（Controller）** | 管理状态机，在三种模式间切换，读写 `.brain/` 文件，调度 LLM 调用 |
| **Decomposer** | 规划里程碑的 LLM 角色 |
| **Executor** | 执行里程碑的 LLM 角色 |
| **Attributor** | 归因并沉淀经验的 LLM 角色 |

---

## 7. 错误行为

| 场景 | 处理 |
|------|------|
| Decomposer 输出格式不合法 | 控制器重试一次；再次失败则写 BLOCK 到 output |
| Executor LLM 调用失败 | 记录到 executionLog（错误条目），继续进入 Attributor |
| Attributor 无法解析 Control Flag | 默认 REPLAN，replanReason = "Attributor 输出无法解析" |
| `.brain/goal.md` 不存在 | 控制器拒绝启动，记录 error 日志，退出进程 |
| `.brain/milestones.md` 为空 | 视为初次启动，进入 DECOMPOSE |
| 连续 REPLAN 超过 N 次（可配置，默认 5）| 自动升级为 BLOCK，写 output 请求外脑介入 |
