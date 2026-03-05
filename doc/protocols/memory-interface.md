# Memory Interface Protocol

**版本**：v1.0  
**日期**：2026-03-05

---

## 1. 概述

本协议定义 openKuroneko 三层记忆的接口语义与存储约定。

---

## 2. 记忆分层

| 层 | 名称 | 生命周期 | 存储 |
|----|------|----------|------|
| L1 | 会话上下文（pi-mono） | 单次 SCL 循环内 | LLM Adapter 消息历史（内存） |
| L2 | 近期记忆 | 按日滚动 | `<tempDir>/memory/` 文件 |
| L3 | 长期语义记忆（Mem0） | 跨会话持久 | Mem0 全局服务 |

---

## 3. L1 会话上下文

由 LLM Adapter 持有，无需外部协议。每次 `llm.chat()` 调用传入完整消息列表。

---

## 4. L2 近期记忆

### 4.1 文件布局

```
<tempDir>/memory/
├── TASKS.md              # 结构化任务状态（覆盖写）
└── daily-YYYY-MM-DD.md   # 每日日志（追加写）
```

### 4.2 TASKS.md

- **格式**：Markdown，自由结构（Agent 自定义）
- **写入语义**：覆盖（`writeFileSync`）；由工具 `read_write_structured_state(action='write')` 触发
- **读取时机**：每轮 R 阶段注入 system prompt

### 4.3 Daily Log

- **格式**：Markdown，每条附时间戳注释 `<!-- ISO8601 -->`
- **写入语义**：追加（`appendFileSync`）；M 阶段每轮写入 LLM 回复摘要
- **读取时机**：每轮 R 阶段注入 system prompt（仅当日）
- **滚动**：按日期分文件，自动创建；旧文件不自动删除（可配置保留天数）

---

## 5. L3 Mem0 语义记忆

### 5.1 部署约定

- 全局单实例（进程外服务），默认地址 `http://localhost:8000`
- 环境变量 `MEM0_BASE_URL` 覆盖地址

### 5.2 隔离约定

- 每个 Agent 以 `user_id = agent_id` 隔离
- 所有 `add` / `search` 调用均携带 `user_id`

### 5.3 API 约定（Mem0 REST）

**写入（M 阶段）**

```
POST /v1/memories/
Content-Type: application/json

{
  "messages": [{ "role": "user", "content": "<LLM 回复摘要>" }],
  "user_id": "<agent_id>"
}
```

**检索（R 阶段）**

```
POST /v1/memories/search/
Content-Type: application/json

{
  "query": "<input 文本>",
  "user_id": "<agent_id>",
  "limit": 5
}
```

响应：`[{ "memory": "..." }, ...]`

### 5.4 错误行为

| 场景 | 处理 |
|------|------|
| Mem0 服务不可达 | 记录 `warn` 日志，返回空列表（不中断循环） |
| 写入失败 | 记录 `warn` 日志，静默跳过 |
| 检索超时 | 记录 `warn` 日志，返回空列表 |

---

## 6. 记忆注入 system prompt 顺序

R 阶段按以下顺序拼接 system prompt：

1. Soul（agent 人格与规则）
2. 工作目录路径
3. Today's Daily Log（L2）
4. TASKS（L2）
5. Mem0 检索结果（L3，最多 5 条）
