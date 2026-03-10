# 内脑产物回传协议（Inner-Brain Deliverables）

**版本**：v1.0  
**日期**：2026-03-05

---

## 1. 概述

内脑向外脑的反馈可能是：**一段话**、**单个/多个文件**、**图片**，或组合。本协议约定内脑如何显式声明「本次要回传的产物」，以及外脑如何解析并下发给用户（含多附件发送）。

参与方：

- **生产者**：内脑（Executor 通过工具登记产物；Controller 在 COMPLETE 时写出带产物列表的事件）
- **消费者**：外脑 PushLoop（解析 COMPLETE 事件中的 `deliverables`，按路径读文件并调用 Channel 下发）

---

## 2. 数据形态

### 2.1 内脑侧：产物登记

- **登记方式**：Executor 在执行过程中可调用工具 **register_deliverable(relative_path)**，将「相对于 workDir 的路径」追加到本任务产物列表。
- **持久化**：列表写入 `<tempDir>/deliverables.json`，格式为 JSON 数组：`["path/to/report.md", "chart.png"]`。路径均相对于 **workDir**，外脑解析时与实例 workDir 拼接得到绝对路径。
- **消费时机**：Controller 在**全部里程碑完成**并写入 COMPLETE 输出前，读取该文件；若存在则将数组作为 COMPLETE 事件的 `deliverables` 字段一并写出。读后清空或删除该文件，避免下次任务误用。

### 2.2 Output 事件扩展（COMPLETE）

COMPLETE 事件 JSON 在现有字段基础上增加可选字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| **message** | string | 必填，完成说明/摘要（与现有一致） |
| **target_user** | string \| undefined | 与现有一致 |
| **ts** | string | 与现有一致 |
| **deliverables** | string[] \| undefined | 可选。本次要回传的文件路径列表，**相对于 workDir**。若存在，外脑优先使用该列表；否则外脑回退为「扫描 workDir 下除 .brain、.tool-outputs 外的全部文件」的旧逻辑。 |

示例：

```json
{"type":"COMPLETE","message":"所有里程碑已完成。\n\n## 最终目标\n...","target_user":"alice","ts":"2026-03-05T12:00:00.000Z","deliverables":["报告.md","output/chart.png"]}
```

### 2.3 外脑侧：解析与下发

- **PushLoop**：解析 COMPLETE 行时，若存在 `deliverables` 且为非空数组，则仅将列表中路径与 **workDir** 拼接后作为附件来源；否则按现有逻辑 `listWorkDirFiles(workDir)` 扫描。
- **附件类型**：根据扩展名推断（image / file / audio / video），与现有 `inferAttachmentType` 一致。
- **大小与数量**：仍受现有上限约束（如单文件 50MB、单次最多 8 个附件）；超出部分仅列路径文本不下发。

---

## 3. 频道侧：多附件发送

- **OutboundMessage** 已支持 `attachments: MessageAttachment[]`。
- 各频道适配器在发送时须支持**多条附件**：先发文本内容，再按顺序发送每条附件（若平台不支持一条消息多附件，则文本一条、每个附件各一条；若支持则按平台 API 拼成一条）。
- 本地路径：`url: "file://<绝对路径>"`，适配器读取本地文件并上传到平台（飞书等）后发送。

---

## 4. 错误与边界

| 情况 | 约定 |
|------|------|
| deliverables.json 不存在或非数组 | 视为无显式产物，外脑使用「扫描 workDir」回退。 |
| 列表中某路径不存在或越界 | 外脑跳过该条，不报错；其余照常下发。 |
| 路径含 `..` 或绝对路径 | 内脑工具应拒绝；外脑解析时若拼接后不在 workDir 下则跳过。 |
| 无 COMPLETE、仅 PROGRESS | 不涉及产物回传；可选未来扩展 PROGRESS 也带 deliverables。 |

---

## 5. 与现有协议的关系

- **io-endpoint**：Output 仍为追加 JSON 行；COMPLETE 行在本协议下增加可选 `deliverables` 字段。
- **内外脑交互方式**：内脑→外脑仍仅通过 output 文件；本协议约定该文件中 COMPLETE 行的扩展格式及外脑对产物列表的处理方式。
