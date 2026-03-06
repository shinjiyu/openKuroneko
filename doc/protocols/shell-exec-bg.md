# Shell Background Exec 协议

**版本**：1.0  
**日期**：2026-03-06

---

## 1. 概述

本协议定义 openKuroneko Agent 的**长驻 shell 执行**机制，支持启动后台进程、轮询输出、发送信号三类操作。适用于：

- Dev server（`npm run dev`、`python -m http.server`）
- 长时间 CI/构建任务（`make`、`cargo build`）
- 文件监听（`tail -f`、`fswatch`）
- 多步骤流水线（启动服务 → 测试 → 关闭）

---

## 2. 参与方

| 角色 | 描述 |
|---|---|
| **生产者** | Executor（LLM 决策层），调用三个 shell 工具 |
| **消费者** | `JobRegistry`（进程注册表），管理后台进程生命周期 |
| **存储** | `<tempDir>/.jobs/<job_id>/` 目录下的 stdout/stderr 文件 |

---

## 3. 工具接口

### 3.1 `shell_exec`（同步，短命令）

保持现有语义，但底层改为 async spawn + 双超时。

```
输入：command, cwd?, timeout?（默认 120s）, noOutputTimeout?（默认 60s）
输出：{ ok, output }（stdout+stderr 合并）
```

超时行为：
- 超过 `timeout`（硬超时）→ SIGKILL，返回 `{ ok: false, output: "timeout after Xs\n<已收集输出>" }`
- 超过 `noOutputTimeout`（无输出超时）→ SIGKILL，返回 `{ ok: false, output: "no output timeout after Xs\n<已收集输出>" }`

### 3.2 `shell_exec_bg`（异步，长驻命令）

```
输入：
  command   string   shell 命令
  cwd?      string   工作目录（默认 workDir）
  label?    string   可读标签（便于日志识别）

输出：
  {
    ok:          boolean
    job_id:      string        // 格式：job-<8位hex>
    pid:         number
    stdout_file: string        // 绝对路径，可用 read_file 读取
    stderr_file: string
    started_at:  string        // ISO 时间戳
  }
```

语义：
- 立即返回，不等待命令结束
- stdout/stderr 分别重定向到独立文件（append 模式）
- 进程注册到 `JobRegistry`，跨工具调用持有引用
- Agent 重启后 job 失效（in-memory 注册表）

### 3.3 `shell_read_output`（轮询输出）

```
输入：
  job_id      string
  tail_lines? number   // 读最后 N 行 stdout（默认 50）
  stderr?     boolean  // 同时读 stderr（默认 false）

输出：
  {
    ok:          boolean
    running:     boolean
    exit_code?:  number        // 仅 running=false 时有值
    elapsed_ms:  number
    stdout_tail: string        // 最后 tail_lines 行
    stderr_tail?: string       // 仅 stderr=true 时
    stdout_file: string        // 完整文件路径（可用 read_file 读全量）
    stderr_file: string
  }
```

### 3.4 `shell_kill`（终止进程）

```
输入：
  job_id  string
  signal? string   // 'SIGTERM'（默认）| 'SIGKILL' | 'SIGINT'

输出：
  { ok: boolean, message: string }
```

语义：
- 发送信号后立即返回（不等待进程退出）
- 调用方可在后续 `shell_read_output` 中确认 `running=false`
- job 从 JobRegistry 移除（无论进程是否已退出）

---

## 4. JobRegistry

- **单例**，模块级 `Map<string, JobEntry>`
- 进程自然退出时，entry 保留（保存 exit_code），不主动删除
- 内存无上限保护（当前阶段 agent 生命周期内任务数有限）

```typescript
interface JobEntry {
  jobId:      string;
  pid:        number;
  process:    ChildProcess;
  stdoutFile: string;
  stderrFile: string;
  startedAt:  Date;
  exitCode:   number | null;   // null = 仍在运行
  label?:     string;
}
```

---

## 5. 文件存储约定

```
<tempDir>/
  .jobs/
    <job_id>/
      stdout   ← 进程 stdout 追加写入
      stderr   ← 进程 stderr 追加写入
```

- 文件在 `shell_exec_bg` 调用时创建（空文件）
- 不自动清理（随 tempDir 生命周期）
- LLM 可用 `read_file` 读取完整输出

---

## 6. 错误行为

| 情形 | 行为 |
|---|---|
| `job_id` 不存在 | `{ ok: false, output: "job not found: <id>" }` |
| 进程启动失败（ENOENT 等） | `shell_exec_bg` 返回 `{ ok: false, output: <error> }` |
| stdout/stderr 文件不可读 | `shell_read_output` 返回空字符串，不报错 |
| 对已退出进程 kill | 返回 `{ ok: true, message: "process already exited (code N)" }` |
