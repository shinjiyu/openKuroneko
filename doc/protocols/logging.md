# 结构化日志协议（工程化 / 可分析）

**版本**：2.0  
**日期**：2026-03-05  
**变更**：在 v1 基础上增加 `schema_version`、`log_id`、`tags`、分析状态字段；定义事后标注的旁路文件，避免直接改主 `.jsonl`。

---

## 1. 目标

- **详细**：单条日志可携带足够上下文（事件名、模块、`data` 对象），支撑故障复盘与行为挖掘。
- **可分析**：稳定字段 + **全局唯一 `log_id`**，便于外部系统（DB、标注平台、批处理）索引与关联。
- **可标注**：区分 **写入时的分析意图** 与 **事后「是否已分析」**；主日志 **追加只写**，事后结论写入 **旁路文件**，保证工程可操作性。

---

## 2. 存储位置

| 载体 | 路径 | 说明 |
|------|------|------|
| 主日志 | `<tempDir>/logs/YYYY-MM-DD.jsonl` | 一行一条 JSON，UTF-8，追加写 |
| 分析旁路（可选） | `<tempDir>/logs/analysis-markers.jsonl` | 仅追加，标记某 `log_id` 的分析结论 |
| 保留策略 | 默认可删超过 N 天的 `.jsonl` | 与 `createLogger(..., { retainDays })` 一致；**删主日志前应同步归档分析库** |

外脑、内脑、自演化等各自 `tempDir` 不同，分析时以 **`agentId` + 日期文件路径** 区分来源。

---

## 3. 主日志行：JSON Schema（逻辑）

每条记录为 **一个 JSON 对象**，字段如下。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `schema_version` | `number` | 是 | 当前为 **2** |
| `log_id` | `string` | 是 | **UUID**（v4），本条全局唯一，用于外部标注与关联 |
| `ts` | `string` | 是 | ISO 8601 时间戳 |
| `level` | `string` | 是 | `debug` \| `info` \| `warn` \| `error` |
| `module` | `string` | 是 | 逻辑模块名，如 `controller`、`io`、`tool` |
| `agentId` | `string` | 是 | 该 Logger 绑定的 agent / 实例标识 |
| `event` | `string` | 是 | 点分或蛇形事件名，如 `executor.tool.call` |
| `tags` | `string[]` | 否 | **分类/过滤标签**，见 §4；省略等价于 `[]` |
| `analyzed` | `boolean` | 是 | **写入时**是否认为「已分析」；openKuroneko 实现**每条必写**（默认 `false`），便于检索与报表 |
| `analyzed_at` | `string` | 否 | 仅当 `analyzed===true` 时出现，ISO 时间 |
| `data` | `object` | 否 | 任意结构化上下文；建议稳定子字段名便于聚合 |

### 3.1 示例

```json
{
  "schema_version": 2,
  "log_id": "7c9e2b4a-8d1f-4a3e-9c2b-1e8f0a7d6c5b",
  "ts": "2026-03-05T12:00:00.000Z",
  "level": "info",
  "module": "executor",
  "agentId": "03e762530d5a5992",
  "event": "tool.call",
  "tags": ["tool", "replay-critical"],
  "analyzed": false,
  "data": { "name": "read_file", "preview": "/path…" }
}
```

（`analyzed: true` 时增加 `analyzed_at` 字段。）

---

## 4. 标签 `tags` 约定

- **自由字符串**，建议小写、用 `-` 连接。
- **推荐保留标签**（可选使用，便于跨模块报表）：

| 标签 | 含义 |
|------|------|
| `replay-critical` | 复盘一条链路时必须保留（如 tick 边界、工具调用、I/O） |
| `tool` | 工具调用相关 |
| `io` | input/output 端点 |
| `memory` | L2 / Mem0 / 归档 |
| `outer-brain` | 外脑独有 |
| `error` | 与错误相关（可与 `level:error` 同时出现） |
| `security` | 安全/拒绝类事件 |

模块可在调用 Logger 时传入 `tags`；未传则仅依赖 `module`/`event` 做分析。

---

## 5. 「是否已分析」语义

### 5.1 写入时（主日志）

- 业务代码可设 `analyzed: true`（极少见，例如自动规则已当场消化）。
- 默认 **不写或写 `analyzed: false`**，表示 **待纳入离线分析管线**。

### 5.2 事后标注（推荐）

**禁止**为批量标注而频繁重写主 `.jsonl`。采用 **旁路追加**：

**文件**：`<tempDir>/logs/analysis-markers.jsonl`  

**每行 JSON**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `schema_version` | `number` | 是 | 1 |
| `log_id` | `string` | 是 | 对应主日志行的 `log_id` |
| `analyzed` | `boolean` | 是 | 通常为 `true` |
| `analyzed_at` | `string` | 是 | ISO 8601 |
| `analyst` | `string` | 否 | 人、服务名或流水线 ID |
| `notes` | `string` | 否 | 短摘要 |
| `labels` | `string[]` | 否 | 分析侧标签（与写入时 `tags` 可区分） |

**合并规则**（消费方）：对同一 `log_id`，以 **时间最晚** 的 marker 为准，或按业务定义合并。

### 5.3 分析流水线输出

导出特征、训练样本时，应输出：`(log_id, source_file, line_no, analyzed_effective, tags_merged)`，其中 `analyzed_effective = marker.analyzed ?? row.analyzed ?? false`。

---

## 6. 与 v1 的兼容

- **旧行**：无 `schema_version` / `log_id` 的消费方应视为 **v1**，`analyzed` 视为 `false`，`tags` 视为 `[]`。
- **新 Logger 实现**：仅产出 **v2** 行。

---

## 7. 实现要求（openKuroneko）

- 所有模块通过 **`createLogger` 返回的 Logger** 写入；`payload` 支持可选 `tags`、`analyzed`、`analyzed_at`。
- 禁止用 `console.log` 替代需留存的生产事件（见仓库 `logging-system` 规则）。
- 可选导出 **`appendAnalysisMarker(tempDir, record)`** 供 CLI/脚本写入 `analysis-markers.jsonl`。
