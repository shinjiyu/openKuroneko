# 轻量多 Agent 系统设计文档

## 一、目标与范围

- **目标**：一个轻量、可多 agent 协作的 AI 系统，与用户界面解耦，通过 input/output **接口**通信。
- **不做**：MCP、subagent 抽象、多 agent 协商、单体 agent 同时负责聊天与长任务。
- **核心原则**：多 agent 对等协作；聊天与工作任务分离；I/O 统一为 input/output **接口定义**，可由不同实现完成（见第六节）。

---

## 二、技术栈

| 组件 | 作用 |
|------|------|
| **pi-mono** | Agent 运行时：推理、工具执行、单会话。不接 MCP（用动态生成脚本替代）；多 agent 通过 input/output 接口与 exec 协作。 |
| **Mem0** | 长期记忆（第三层）：add / search，语义检索。 |
| **动态上下文 (file as context)** | 工作目录 = agent 的**操作对象**（另一项目的源码根目录）；agent 用 read/write/edit/shell 等按需访问。与 agent 自身配置/记忆分离。 |
| **定时 loop** | 按 cron 或间隔触发单次 agent run（如日报、巡检），无交互，结果可写记忆或文件。 |

---

## 三、记忆分层与存储约定

| 层 | 实现 | 说明 |
|----|------|------|
| **第一层** | pi-mono 会话 | 当前轮次上下文，不单独实现。 |
| **第二层** | 自建 | 近期记忆（如最近 N 条摘要、Daily Log）；按时间存/取。 |
| **第三层** | Mem0 | 长期语义记忆，add/search，去重与合并由 Mem0 负责。 |

- **存储位置**：Agent 的**配置、记忆、Soul** 等均放在**全局临时目录**下，按 **agent id** 区分子目录（如 `<全局临时目录>/<agent_id>/`），避免多 agent 互相覆盖。Soul 文件也在该目录内（如 `SOUL.md`）。
- **Agent id**：由身份（MAC + 路径）**哈希**派生，保证唯一；具体算法实现自定（如 SHA256(MAC+path) 取前 16 字符）。
- **记忆与 SCL**：SCL 的 memory 语义（TASKS、Daily Log、长期记忆等）按本项目的记忆实现做调整；**记忆以接口形式对接**，SCL 侧与本地实现通过接口交互，两边不关心具体存储形态。
- 仅 **work agent** 需要完整记忆（含 Mem0）。Mem0 部署与隔离见第十节。

---

## 四、角色与消息模型

- 使用标准 **system / user / assistant** 三角色。
- **user**：用户输入 + 其它 agent 的输入，可加前缀区分（如 `[User]` / `[Agent: id]`），也可不加。
- **assistant**：当前模型（当前 agent）的回复。
- **system**：系统指令、soul、上下文摘要、记忆摘要等。

---

## 五、Soul 与热载

- **Soul 文件**：定义 agent 人设、规则、默认行为（类似 OpenClaw soul）；存放在该 agent 的**临时目录**内（与配置、记忆同目录）。
- **热载**：监听 soul 文件变更，不重启进程即可重新加载并更新 system 或运行时配置（如 chokidar + 重新读入）。

---

## 六、Agent 身份、临时目录与工作目录

- **身份唯一性**：Agent 身份由**本机 MAC 地址 + 路径**唯一确定。同一 (MAC, path) 即同一 agent；不同机器或不同路径即不同 agent。**Agent id** = 对该身份做**哈希**后的结果（实现自定，如 SHA256 取前 16 字符），用于临时目录名、Mem0 user_id 等。
- **临时目录**：每个 agent 在**全局临时目录**下拥有一个以 agent id 区分的子目录（如 `<全局临时目录>/<agent_id>/`），其内存放该 agent 的**配置、记忆、Soul**；input/output 接口若实现为文件，也可放在此目录或由配置指向。
- **工作目录**：Agent 的**操作对象**，即另一项目的源码根目录；与临时目录分离。read_file、write_file、shell_exec 等工具的操作范围限定在工作目录（或实现规定的白名单）。多 agent 协作时，每个子 agent 可有自己的临时目录与工作目录。
- **路径独占**：**同一（身份）路径上不允许同时运行两个 agent**。实现可用锁、pid 文件等保证互斥。

---

## 七、Input / Output 接口

- **接口而非必选实现**：input/output 是**接口定义**，约定「有可读的 input、可写的 output，且单生产者-单消费者」。具体实现可由任务/运行时提供：可以是真实文件、内存队列、消息队列、RPC 等，只要满足该接口契约即可。
- **端点模型**：每个 input/output 端点均为**单生产者-单消费者**。不允许多个写者写同一 input、或多个读者读同一 output；一个端点上一写一读。
- **多端点**：允许为一个 agent 配置**多个** input/output 端点（命名示例：`in/user`、`out/user` 与 `in/agent_b`、`out/agent_b`）。每个端点仍遵守一写一读；不同端点可对应不同生产者/消费者（如 UI 占一端、另一 agent 占一端）。端点的具体形态由实现决定（如文件路径、队列名、channel 句柄等）。
- **端点来源**：提供机制**同时支持**「启动时指定」（如 CLI、配置文件）与「运行时注册」（如 API、回调注册新端点），便于编排与扩展。
- **input**：发给该 agent 的内容。由该端点的**唯一生产者**写入；agent 每次 run 前（或通过工具）从该接口**读取**作为本轮 user 输入。
- **output**：该 agent 对外的回复。agent 通过专用工具向该端点的接口**写入**；由该端点的**唯一消费者**读取。
- **多 agent 通信**：Agent A 与 Agent B 通信 = A 作为 B 某 input 端点的生产者向 B 的 input 写入，B 跑完后向该对应 output 端点写入，A 作为该 output 端点的消费者读取。
- **用户交互**：UI 作为某端点唯一生产者向该 agent 的 input 写入、作为唯一消费者从该 agent 的 output 读取；UI 为独立程序，与 agent 层仅通过约定好的 input/output 接口交互。

---

## 八、Work Agent 工具集

参考 [Structured-Cognitive-Loop-Skills](https://github.com/shinjiyu/Structured-Cognitive-Loop-Skills) 的原子能力与 Skill 设计，Work Agent 需实现以下工具（具体可由 pi-mono 或本系统封装）：

### 8.1 基础与专用工具

| 工具 | 作用 | 说明 |
|------|------|------|
| **read_file** | 读工作目录/记忆 | 读工作目录内源码；读 TASKS、Daily Log、配置等（通过记忆接口或临时目录内文件）。 |
| **write_file** | 写工作目录/记忆 | 写工作目录内文件；写 TASKS、Daily Log、新 Skill 等（通过记忆接口或临时目录内文件）。 |
| **edit_file** | 局部编辑文件 | 可选，或由 read_file + write_file 替代。 |
| **shell_exec** | 执行 shell 命令 | 计算、安装、调用脚本；限制在**工作目录**或白名单内。 |
| **web_search** | 外部信息检索 | 能力缺口自举时搜索实现方案、Skill、API。 |
| **get_time** | 获取当前时间 | 调度、超时、定时决策。 |
| **reply_to_user(content)** | 写 output 端点 | 将 content 写入当前 agent 的**主 output**，作为对调用方的正式回复；多端点时写主端点。 |
| **run_agent** | 调起子 agent（exec） | 向另一路径写 input、exec 同程序 `--once --dir <path>`、等退出、读 output，实现串联。 |

### 8.2 结构化状态与记忆

| 能力 | 说明 |
|------|------|
| **read_write_structured_state** | 跨轮任务状态：TASKS（子任务树、状态、执行摘要）的可靠读写。可用结构化文件（如 Markdown 表格）+ 约定格式实现，保证「上轮写入的本轮可读」。 |
| **Mem0** | 长期语义记忆：add / search；每轮开始可自动 search 注入 context，每轮结束可自动 add 摘要；隔离见第十节。 |

### 8.3 元规则（非单次工具调用）

| 元规则 | 说明 |
|--------|------|
| **capability_gap_handler** | 当 Action 因工具/Skill 不存在失败时：本轮仅**标记缺口**；**下一轮**再执行自举（web_search、write_file 写新 Skill/脚本、更新 TASKS 与 Daily Log），然后重试原任务；仅当需 API Key/人类确认时才上报。 |

---

## 九、启动与循环模式

参考 [Structured-Cognitive-Loop-Skills](https://github.com/shinjiyu/Structured-Cognitive-Loop-Skills)：单次「跑一轮」= 一次 **R-CCAM + ReCAP** 执行（见第九.1 节）；循环 = 重复该执行。提供三种模式：

| 模式 | 行为 | 用途 |
|------|------|------|
| **1. 快速循环** | 上一轮 LLM 调用一结束**立即**开始下一轮。需加**防空转退避**：若连续 N 轮无新 input、且无实质性工具调用或状态变更，则拉长间隔（如指数退避），避免空转耗资源。 | 有持续 input 或高优先级任务流时。 |
| **2. 定时循环** | 每隔固定时长（如 5min / 30min）触发一轮；或按 cron 表达式。每轮开始时读 input（若有）；**无 input 时**仍可跑，本轮输入使用 **SCL 控制提示词**（如 HEARTBEAT 检查清单或等效）；SCL 本身是循环，可据此执行日报、巡检等。 | 常驻 worker、定时任务、心跳式运行。 |
| **3. 单次循环** | 读 input → 跑一轮 R-CCAM+ReCAP → 写 output，**进程退出**。无循环。 | 被父 agent 或编排层 exec 调起，「子」agent 或一次性任务。 |

父 agent 通过 **exec** 在另一路径启动同一程序（如 `--once --dir <path>`），实现串联：父写子 input，exec 一次，等退出后读子 output。`--dir` 可指该次 run 的临时目录或身份路径（第六节）；工作目录可另参或与路径一致由实现约定。

### 9.1 单次循环内步骤：R-CCAM + ReCAP 融合

每一轮执行按以下结构运行（与 SCL/ReCAP 对齐，不依赖 OpenClaw 具体实现）：

```
R - Retrieval：读取任务/记忆状态（TASKS、近期记忆、Mem0 检索结果），组装本轮 context
     ↓
C - Cognition：决策「当前做什么」
  ├─ 若尚无任务树或需重分解 → 执行 ReCAP 分解，生成/更新子任务树（写 TASKS）
  ├─ 若有任务树 → 选择下一个待执行节点作为本轮目标
  └─ 输出：本轮执行目标 + 策略
     ↓
C - Control：执行前验证（范围、约束、风险、工具可用性）；若工具缺失 → **仅标记缺口**，下一轮再执行自举（见工具集）
     ↓
A - Action：执行单步行动（工具调用）
     ↓
M - Memory：写回 Daily Log、更新 TASKS 状态、必要时提炼到长期记忆（Mem0）；reply_to_user 若有则写 output
```

- **ReCAP**：在 Cognition 内完成；负责抽象目标分解为子任务树、写入/更新 TASKS、选择当前节点。
- **能力缺口**：Action 因工具不存在失败时，本轮标记缺口，**下一轮**再执行自举（见工具集）；仅当需 API Key/人类确认时才上报。
- **无 input 时**：定时/快速循环下若无 input，本轮 user 输入使用 **SCL 控制提示词**（如 HEARTBEAT 检查清单或等效），SCL 循环据此驱动定时任务与巡检。

---

## 十、聊天与 Mem0 部署

### 10.1 聊天部分

- **暂不实现**。聊天与工作任务分离、聊天 LLM 仅「创建 work agent」等设计保留为后续阶段再做；当前仅实现 Work Agent 与 Loop。

### 10.2 Mem0：全局单实例，按 agent 隔离

- **部署**：全局只启动**一个** Mem0 服务（单进程或单实例）；所有 agent 共用该服务。
- **隔离**：各 agent **自行隔离**，通过 Mem0 的 **user_id**（或等价命名空间）区分：每个 work agent 使用唯一 user_id（如 agent_id = MAC+路径 的哈希或字符串），所有 add/search 均带该 user_id，Mem0 按 user_id 做逻辑隔离，互不串数据。
- **配置**：Mem0 的 endpoint、API key 等由全局配置或环境变量提供；agent 仅需传入自己的 agent_id 作为 user_id。

---

## 十一、多 Agent 协作方式（已采纳）

- **中心化串联**：一个 agent 作为协调者，通过 **exec** 在另一上下文中启动自身（单次 run），向子的 input 写入、等退出、从子的 output 读取，实现任务拆分与结果汇总。无需单独 orchestrator。
- **不采纳**：多 agent 非中心化协商（视为低效，不做专门设计）。

---

## 十二、与用户界面的边界

- **Agent 侧**：无 UI；只提供「能力 + input/output 接口 + 可选定时 loop」。
- **用户界面**：独立程序；仅通过各 agent 的 input/output 接口（读/写及按需触发 run）与系统交互。协议即接口契约与约定格式；具体是文件、队列或其它由实现决定。
- **错误与返回值**：错误视为**正常结果**写入 output（返回值），不单独走异常通道；SCL 有能力在循环内处理错误状态并决定下一步。

---

## 十三、设计小结

| 项 | 结论 |
|----|------|
| Agent 身份 | 本机 MAC + 路径唯一确定；同一路径不可同时运行两个 agent |
| 栈 | pi-mono + Mem0 + file-as-context + 三种循环模式 |
| 记忆 | 会话 + 自建近期（全局临时目录按 agent id 分目录）+ Mem0 长期；Mem0 全局单实例、按 user_id(agent_id) 隔离 |
| I/O | 每 agent 一组或多组 input/output **接口**（可多实现） |
| Soul | 支持，热载 |
| Work 工具 | read_file/write_file/shell_exec/web_search/get_time/reply_to_user/run_agent + 结构化状态 + Mem0 + capability_gap_handler |
| 循环 | 快速循环（防空转退避）+ 定时循环 + 单次循环；单次内 R-CCAM + ReCAP 融合 |
| 聊天 | **暂不实现**，后续再说 |
| 多 agent | 串联通过 exec 自启动（另一路径单次 run）；不设计协商 |
| 错误 | 视为正常结果写入 output，由 SCL/调用方处理 |

此文档为当前设计共识，可作为实现与评审的基准。
