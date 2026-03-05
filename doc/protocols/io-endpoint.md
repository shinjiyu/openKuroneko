# I/O Endpoint Protocol

**版本**：v1.0  
**日期**：2026-03-05

---

## 1. 概述

本协议定义 openKuroneko 中 **Input / Output 端点**的接口语义、数据格式与消费约定。

---

## 2. 参与方

| 角色 | 说明 |
|------|------|
| **生产者（Producer）** | 往 Input 端点写入内容的一方（用户、父 Agent、调度器） |
| **消费者（Consumer）** | 读取 Input 端点内容的一方（本 Agent 的 Runner） |
| **写入者（Writer）** | 往 Output 端点写入内容的一方（本 Agent 的 Runner / reply_to_user 工具） |
| **读取者（Reader）** | 读取 Output 端点内容的一方（用户、父 Agent） |

**约束**：每个端点同一时刻只允许 **一个生产者 + 一个消费者**（单写单读）。多端点通过 `id` 区分，同一 Agent 可注册多个端点。

---

## 3. 端点标识

```
endpoint_id ::= [a-zA-Z0-9_-]+
```

默认端点 id 为 `"default"`。

---

## 4. 数据格式

- **编码**：UTF-8 纯文本
- **内容类型**：无结构约束（LLM 消息文本）；如需结构化，使用 JSON，且必须是合法 JSON 字符串
- **最大长度**：建议不超过 1 MB（实现可自定义）

---

## 5. Input 端点语义

### 5.1 写入语义（生产者）

- 写入为**覆盖**（overwrite）：每次写入替换上一条未消费内容
- 若上一条内容未被消费，新内容覆盖旧内容（生产者负责幂等或去重）

### 5.2 读取/消费语义（消费者）

- 读取后**立即消费**（consume after read）
- 文件型实现：读取后执行 `truncate(0)`
- 内存型实现：读取后从队列 dequeue
- 若端点为空（无内容），返回 `null`（不阻塞）

### 5.3 空值约定

- 返回 `null` 或空字符串均视为"无新输入"
- Runner 在无输入时使用 **SCL 控制提示词**驱动循环

---

## 6. Output 端点语义

### 6.1 写入语义（写入者）

- 写入为**覆盖**（overwrite）：每次调用 `reply_to_user` 或直接写入替换上一条输出
- 写入时不等待读取方确认（fire-and-forget）

### 6.2 读取语义（读取者）

- 读取者自行轮询或监听；写入后不保证通知
- 文件型实现：读取者读文件，读后可自行 truncate 或保留

---

## 7. 文件型实现约定

| 属性 | 值 |
|------|----|
| 存储位置（默认端点） | `<tempDir>/input`、`<tempDir>/output` |
| 文件编码 | UTF-8 |
| Input 消费 | `fs.truncateSync(path, 0)` |
| Output 写入 | `fs.writeFileSync(path, content, 'utf8')` |
| 端点不存在时 | 自动创建（`mkdirSync` recursive） |

---

## 8. 运行时注册

端点可在启动时通过 CLI/config 指定，也可在运行时通过 `IORegistry.registerInput/registerOutput` 动态注册。注册后不可移除（进程级生命周期）。

---

## 9. 错误行为

| 场景 | 处理 |
|------|------|
| Input 文件不存在 | 视为空输入，返回 `null` |
| Input 文件读取权限不足 | 记录 `error` 日志，返回 `null`，不崩溃 |
| Output 写入失败 | 记录 `error` 日志，作为工具调用错误返回给 Runner |
| 格式非法（预期 JSON 但收到非 JSON） | 由 Runner 层处理，原样传递给 LLM |
