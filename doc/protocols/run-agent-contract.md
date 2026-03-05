# run_agent 调用契约

**版本**：v1.0  
**日期**：2026-03-05

---

## 1. 概述

`run_agent` 工具允许当前 Agent（父）以子进程方式启动另一个 Agent（子）。本协议定义调用参数、进程语义、I/O 传递与退出码约定。

---

## 2. 参与方

| 角色 | 说明 |
|------|------|
| **父 Agent** | 调用 `run_agent` 的一方，发起子进程 |
| **子 Agent** | 被启动的 openKuroneko 进程 |

---

## 3. 工具参数

```ts
interface RunAgentArgs {
  path: string;       // 子 Agent 的目录路径（必填）；决定子 Agent 的 identity
  args?: string[];    // 额外 CLI 参数（追加到命令末尾）
  once?: boolean;     // true → --once 单次运行；false/省略 → 使用子 Agent 自身 loopMode
  input?: string;     // 启动前写入子 Agent 默认 input 端点的内容（可选）
}
```

---

## 4. 调用命令

```
node dist/cli/index.js --dir <path> [--once] [...args]
```

父进程使用 `spawnSync`（单次）或 `spawn`（后台）执行上述命令。

---

## 5. Input 传递约定

若 `input` 字段非空，父 Agent 在启动子进程**之前**将内容写入子 Agent 的默认 Input 端点文件：

```
<全局临时目录>/<child_agent_id>/input
```

子 Agent 的 identity（`child_agent_id`）由 `hash(MAC + path)[:16]` 推导，与子进程启动后自行计算的结果一致。

---

## 6. Output 读取约定

子 Agent 的输出写入其自身的 Output 端点（`<tempDir>/output`）。

- `once` 模式：父 Agent 可在子进程退出后读取 `<child_tempDir>/output`
- 后台模式：父 Agent 自行轮询或监听

---

## 7. 退出码约定

| 退出码 | 含义 |
|--------|------|
| `0` | 正常完成 |
| `1` | 运行时错误（工具失败、LLM 不可用等） |
| `2` | 启动错误（路径锁冲突、配置解析失败等） |

---

## 8. 路径锁

子 Agent 启动时会尝试获取路径锁（见 Identity 协议）。若同一路径已有进程在运行，子进程以退出码 `2` 退出，父 Agent 的工具调用返回错误。

---

## 9. 错误行为

| 场景 | 处理 |
|------|------|
| `path` 不存在 | 工具返回 `{ ok: false, output: "path not found" }` |
| 路径锁冲突 | 工具返回 `{ ok: false, output: "already locked by PID ..." }` |
| 子进程超时（默认 60s） | 工具返回 `{ ok: false, output: "timeout" }` |
| 子进程 stderr | 拼入 output 字段一并返回 |
