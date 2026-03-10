# 技能渐进式披露设计（Skills Progressive Disclosure）

**版本**：v1.0  
**日期**：2026-03-05

---

## 1. 背景与动机

### 1.1 问题

若在 Executor 每轮执行时，将「与当前里程碑相关的技能」的**全文**一次性注入到 LLM 的上下文中，会带来：

- **注意力稀释**：上下文越长，中间内容权重越低（“Lost in the Middle”），关键步骤容易被忽略。
- **指令干扰**：多条技能同时存在时，规则与示例可能产生隐性冲突，模型输出变得含糊或折中。
- **成本与延迟**：按 token 计费且每轮都带长上下文，成本与 TTFT 同步上升。

### 1.2 思路来源

**渐进式披露（Progressive Disclosure）** 源自 UX：在任意时刻只展示用户**当前需要**的信息，高级选项与细节延后到真正需要时再呈现。迁移到 AI Agent 的技能设计上：

- **首轮**：只给「技能索引」（名称、id、分类、标签等轻量元数据），相当于目录。
- **按需**：当模型决定需要某条技能的具体步骤时，再通过工具拉取该条技能的**全文**。

这样上下文更精简、相关性更高，同时保留「需要时能拿到完整内容」的能力。

### 1.3 参考资料

| 来源 | 要点 |
|------|------|
| [Progressive Disclosure Is the Soul of Skills](https://dev.to/miaoshuyo/progressive-disclosure-is-the-soul-of-skills-5bi1) | 三层加载（Entry → Capability → Execution）、注意力稀释与指令干扰、token 节省与准确率数据 |
| [Claude Skills 渐进式披露架构](https://skills.deeptoai.com/zh/docs/development/progressive-disclosure-architecture) | 元数据扫描（~100 tokens/skill）→ 条件加载 → 资源按需加载；数百技能可用而不压垮上下文 |
| [Anthropic: Progressive Disclosure for Agent Context Management](https://www.decisionpatterns.dev/patterns/anthropic-engineering-progressive-disclosure-for-age-042) | 启动时只加载 skill 元数据，任务触发时再读完整 SKILL.md，按需导航到附加文件 |
| 中文综述（Agent 技能渐进式披露） | 从「静态提示词」到「动态上下文」：Expand（按需加载）与 Contract（隐藏/摘要/索引）交替 |

---

## 2. 本系统实现

### 2.1 分层约定

| 层级 | 内容 | 注入时机 |
|------|------|----------|
| **L1 索引** | id、category、title、tags（每条约 1 行） | Executor 首条 user message 的「技能库」段落 |
| **L2 全文** | 单条技能的完整 .md（场景/步骤/验证） | 模型调用 `get_skill_content(skill_id)` 时返回 |

不预先注入 L2；仅在模型显式请求某条技能时再加载。

### 2.2 Executor 行为

- **检索**：仍用「当前里程碑 title + description」做 `searchSkills`，取 top-K（默认 6）条最相关技能。
- **注入**：只将上述条目的**索引**写入 `## 技能库（可复用操作模式，索引）`：
  - 每行格式：`- **标题** | id: \`<id>\` | category: xxx | tags: a, b`
  - 并注明：「如需某条的完整内容与操作步骤，请调用 **get_skill_content** 并传入对应 skill_id。」
- **系统提示**：明确写「技能库首轮仅提供索引；需要某条技能的完整步骤时，调用 get_skill_content(skill_id) 获取」。

### 2.3 工具

| 工具 | 用途 |
|------|------|
| **get_skill_content(skill_id)** | 从本内脑 `.brain/skills/` 按 id 读取单条技能全文并返回，供 Executor 按需加载 L2。 |
| **query_available_skills(query, top_k)** | 查询外部技能库（如外脑池），返回匹配技能的摘要/全文；当本地索引不足时使用。 |

二者配合：本地技能「先索引、后全文」；外部技能「按查询拉取」。

### 2.4 与 Agent 池的关系

- **创建内脑时**：外脑按目标做相关技能选择，只注入选中技能到 `workDir/.brain/skills/`（见 [agent-pool](../protocols/agent-pool.md)）。
- **执行时**：Executor 对这些本地技能做渐进式披露（索引 → get_skill_content）；若仍不足，可通过 query_available_skills 查外脑池。
- **内脑结束时**：本地新增技能归档回外脑池，不改变本设计。

---

## 3. 错误与边界

| 情况 | 约定 |
|------|------|
| 索引为空 | 技能库段落写「暂无已积累技能」，并提示可调用 query_available_skills 查外部库。 |
| get_skill_content 传入不存在的 id | 返回「未找到 id 为 xxx 的技能」，不抛错。 |
| 技能文件缺失但索引存在 | 返回「技能文件不存在：.brain/skills/...」，不抛错。 |

---

## 4. 与现有协议的关系

- **evolutionary-loop**：Executor 的「技能库」段落语义改为「索引 + 按需 get_skill_content」；归因与其它模式不变。
- **agent-pool**：外脑侧「选择后注入」与「结束时归档」不变；内脑侧技能使用方式按本文档做渐进式披露。

---

## 5. 实现位置

| 模块 | 文件 | 说明 |
|------|------|------|
| Executor 注入 | `src/controller/executor.ts` | 仅注入技能索引，提示调用 get_skill_content |
| 按需拉取工具 | `src/tools/definitions/get-skill-content.ts` | get_skill_content(skill_id) |
| 工具注册 | `src/cli/index.ts` | Executor 工具集包含 get_skill_content |
