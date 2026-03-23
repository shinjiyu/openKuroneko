# 自演化（Self-Evolution）协议 — Git Worktree 模型

**版本**：2.0  
**日期**：2026-03-05  
**变更**：弃用「单工作区 begin/reset」为默认路径；**多内脑并行**时每实例使用 **独立 worktree + 独立分支**，合并阶段再并入主分支（`main` / `master`）。

---

## 1. 目标

- 多个内脑可同时各自改代码，**互不抢占**同一 Git 工作树。
- 每个实例：`git worktree add` + 新分支 `evolve/<instanceId>`（或带后缀保证唯一）。
- 开发在 **`<tmp>/kuroneko-repo-wt/<hash>/<instanceId>/`**（或等价路径）完成；提交只增加该分支上的 commit。
- **合并**：在主工作树（仓库根）执行 `checkout <主分支>` + `merge evolve/<instanceId>`。
- **放弃**：`git worktree remove` + 删除未合并分支（`branch -D`）。

---

## 2. 参与方

| 角色 | 职责 |
|------|------|
| **InnerBrainPool** | 若配置 `gitRepoRoot`，在 `launch()` 时创建 worktree，**内脑 `--dir` 指向 worktree 路径** |
| **内脑进程** | 在 worktree 内正常编辑、`shell_exec` 下 `git commit`（已在目标分支上） |
| **外脑** | 不调用 evolve 工具；仅派发内脑任务。合并/验证由人工或 `kuroneko-evolve` 等其它入口完成（实现可参考 `src/outer-brain/tools/evolution-ob-tools.ts`，默认不挂到外脑工具列表） |
| **人类** | 配置 `gitRepoRoot`、处理合并冲突、必要时 `git push` |

---

## 3. 数据与路径

| 项 | 说明 |
|----|------|
| `gitRepoRoot` | 主克隆根目录（须为已有 `.git` 的工作副本根） |
| `worktreePath` | `$OPENKURONEKO_TMP/kuroneko-repo-wt/<repoShortHash>/<instanceId>/` |
| `evolveBranch` | 如 `evolve/ib-m1abc-xyz` |
| `mainBranch` | 由 `origin/HEAD` 或存在性探测得到 `main` 或 `master` |

实例记录（进程池）须持久化：`gitWorktreePath`、`gitEvolveBranch`、`gitRepoRoot`（或可从池配置推导）。

---

## 4. 流程

### 4.1 启动实例（配置了 gitRepoRoot）

1. 并发数仍受 `maxConcurrent` 限制。
2. `git worktree add <worktreePath> -b <evolveBranch> <startPoint>`，`startPoint` 默认主分支 `HEAD`。
3. `workDir = worktreePath`，`tempDir = deriveAgentId(workDir)`（与现逻辑一致）。
4. 写入 goal、status、技能种子等到 **worktree** 下（`.brain` 在 worktree 内）。

### 4.2 内脑开发

- 所有文件操作相对于 **worktree**；`git commit` 只影响 **evolveBranch**。

### 4.3 验证（可选）

- 外脑 `evolution_worktree_verify`：在 `worktreePath` 下执行 `npm run build`（或可配置命令）。

### 4.4 合并

1. 在主工作树 `gitRepoRoot`：`git checkout <mainBranch>`，`git merge --no-ff` 或 `--ff`（实现可选）`evolveBranch`。
2. 成功后可：`git worktree remove <worktreePath>`，`git branch -d evolveBranch`（已合并）。

### 4.5 放弃

1. `git worktree remove --force <worktreePath>`。
2. `git branch -D <evolveBranch>`（未合并则强删）。

---

## 5. 错误与边界

| 情况 | 行为 |
|------|------|
| 非 Git 根 / worktree add 失败 | `launch` 失败，不启动子进程 |
| 分支已存在 | 实现应加后缀重试分支名 |
| 合并冲突 | merge 命令非零退出；由人类解决；协议不自动强推 |
| 未配置 gitRepoRoot | 回退为 **v1 行为**：`tasks/<id>/` 在 ob-agent 下，**不使用** worktree |

---

## 6. 与 v1（单树 begin/rollback）的关系

- **`kuroneko-evolve` 旧子命令**（`begin`/`verify`/`commit`/`rollback`）仍可作**人工单线程**辅助；与 worktree 模型**独立**。
- **外脑**不向 LLM 暴露 evolve 类工具；**内脑**在 worktree 上开发与提交；合并进主分支由人工或其它流程处理。

---

## 7. 安全

- `verify` 的命令字符串仅来自受信配置/工具参数。
- `merge`/`abort` 仅作用于池内登记的 `instance_id` 对应路径，禁止任意路径参数。
