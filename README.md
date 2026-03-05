# openKuroneko

轻量多 Agent AI 系统 —— 基于 SCL/ReCAP 认知循环、文件 I/O 接口与分层记忆（Mem0）。

## 架构概览

```
Entry/CLI → Identity → Config/Soul → I/O Registry
                                  ↓
               Loop Scheduler → R-CCAM Runner
                                  ↓
              Tools ← Memory(L2) ← Mem0(L3) ← LLM Adapter
                                  ↓
                             Logger (M11)
```

| 模块 | 目录 | 说明 |
|------|------|------|
| Identity | `src/identity` | Agent ID（MAC+路径哈希）、临时目录、路径排他锁 |
| Config/Soul | `src/config` | `agent.config.json` 加载、`soul.md` 热载 |
| I/O Registry | `src/io` | 单生产者-单消费者端点注册与实现 |
| Memory L2 | `src/memory` | Daily Log + TASKS（近期记忆） |
| Mem0 Client | `src/mem0` | 长期语义记忆（全局单实例，按 agent_id 隔离） |
| Tools | `src/tools` | 10 种工具：read/write/edit_file, shell_exec, web_search, get_time, reply_to_user, run_agent, state, capability_gap |
| Loop Scheduler | `src/loop` | once / interval / fast（防空转退避）三种模式 |
| R-CCAM Runner | `src/runner` | Retrieval → Cognition → Action → Memory |
| LLM Adapter | `src/adapter` | OpenAI Chat Completions（可替换） |
| Logger | `src/logger` | 结构化 JSON Lines 日志，落 `<tempDir>/logs/YYYY-MM-DD.jsonl` |

详细设计见 [`doc/`](./doc/) 目录。

## 快速开始

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，填写 OPENAI_API_KEY 等

# 编译
npm run build

# 单次运行（指定 agent 目录）
node dist/cli/index.js --dir ./my-agent --once

# 快速循环模式
node dist/cli/index.js --dir ./my-agent --loop fast

# 定时循环（每 60 秒）
node dist/cli/index.js --dir ./my-agent --loop interval --interval-ms 60000
```

## Agent 目录结构

每个 agent 在 `$OPENKURONEKO_TMP/<agent_id>/` 下自动创建：

```
<agent_id>/
├── agent.config.json   # 配置（可选）
├── soul.md             # 人格与规则（可选，支持热载）
├── input               # 默认输入端点（单生产者写入）
├── output              # 默认输出端点（agent 写入）
├── memory/
│   ├── TASKS.md        # 结构化任务状态
│   └── daily-YYYY-MM-DD.md  # 每日日志
└── logs/
    └── YYYY-MM-DD.jsonl     # 结构化运行日志
```

## 开发规范

- **协议先行**：新增模块间接口前，先在 `doc/protocols/<name>.md` 确定协议文档。
- **日志规范**：所有模块通过 `M11 Logger` 写结构化日志，禁止直接 `console.log`。

## 开发进度

- [x] P0：Identity、Logger、Config、I/O Registry 骨架
- [x] P0：工具集骨架（10 种工具）
- [x] P0：Loop Scheduler（三种模式）
- [x] P0：R-CCAM Runner 骨架
- [x] P0：CLI 入口
- [ ] P1：LLM 工具调用完整循环联调
- [ ] P1：Memory L2 完整读写注入
- [ ] P1：Mem0 对接
- [ ] P2：web_search 接入真实搜索 API
- [ ] P2：run_agent 子进程联调
- [ ] P3：Chat 模块（暂不实现）

## License

MIT
