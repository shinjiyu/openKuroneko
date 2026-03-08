
<!-- 2026-03-07T16:21:30.500Z -->
[事实] read_file 工具有严格的路径白名单检查，仅允许访问 workDir 和 tempDir，尝试读取父目录会触发 "Security violation: path ... is outside allowed directories" 错误

<!-- 2026-03-07T16:21:38.607Z -->
[事实] openkuroneko 系统采用双进程架构：外脑负责用户交互（soul.md + Channel Adapters + Conversation Loop），内脑负责核心决策（BrainFS + Controller + Runner + Tools），两者通过 <tempDir>/input、directives、output、status 文件通信

<!-- 2026-03-07T16:25:19.261Z -->
[事实] openKuroneko 采用双脑架构：外脑（outer-brain）负责人类交互与战略定义，内脑（controller）负责环境演化与目标执行，通过 .brain/ 文件系统解耦，不共享内存对话

<!-- 2026-03-07T16:25:59.736Z -->
[事实] openKuroneko 采用双脑解耦架构：外脑负责多渠道（CLI/WebChat/飞书）人机对话与战略定义，内脑负责自主目标推进（DECOMPOSE/EXECUTE/ATTRIBUTE 循环）。两者通过 .brain/ 目录下的 Markdown 文件系统解耦通信（goal.md/milestones.md/constraints.md/knowledge.md/skills.md/controller-state.json）。

<!-- 2026-03-07T16:25:59.737Z -->
[事实] 内脑演化循环的四种模式：DECOMPOSE（战术拆解，生成/重排 milestones.md）、EXECUTE（反应执行，调用工具推进 Active 里程碑）、ATTRIBUTE（强制归因，提取约束/技能/知识并决定控制流）、BLOCKED（等待外脑干预）。控制器通过 BrainFS 类统一读写 .brain/ 文件。

<!-- 2026-03-07T16:25:59.737Z -->
[事实] 工具系统分为两类：Executor 可用全套工具（read/write/edit_file, shell_exec, web_search, run_agent, capability_gap 等），Attributor 仅可用三个归因工具（write_constraint/write_skill/write_knowledge）。所有文件操作受 workdir-guard 保护，仅允许访问 workDir 和 tempDir。

<!-- 2026-03-07T16:25:59.737Z -->
[事实] 外脑通过 ChannelAdapter 抽象对接多渠道（cli/webchat/feishu/dingtalk/wechat/telegram），消息格式统一为 InboundMessage（channel_id/thread_id/user_id/content）。ConversationLoop 处理对话，PushLoop 监控内脑 output 并推送通知。

<!-- 2026-03-07T16:30:04.060Z -->
[事实] openKuroneko 采用双脑架构：内脑（kuroneko CLI）在 DECOMPOSE/EXECUTE/ATTRIBUTE/BLOCKED 四态之间循环推进目标；外脑（kuroneko-ob CLI）通过多渠道（CLI/飞书/WebChat）与用户对话，并通过 .brain/ 文件系统（goal/milestones/constraints/knowledge/skills/environment）与内脑解耦通信。

<!-- 2026-03-07T16:30:04.062Z -->
[事实] 内脑核心模块包括：controller（四态循环调度）、brain/BrainFS（.brain/ 文件系统管理）、tools（executor/attributor 工具集）、memory/mem0（记忆分层）、runner（单次 SCL/ReCAP 循环）。

<!-- 2026-03-07T16:30:04.062Z -->
[事实] 外脑核心模块包括：outer-brain（ConversationLoop、InnerBrainManager、PushLoop、BlockEscalation）、channels（适配器：CLI/Feishu/WebChat）、threads/ThreadStore、users/UserStore、外脑受限工具集（read_inner_status、send_directive、set_goal、stop_inner_brain、search_thread）。

<!-- 2026-03-07T16:30:04.062Z -->
[事实] 通信管道：内脑通过 .brain/ 六个 Markdown/JSON 文件持久化状态；外脑通过 ChannelAdapter 接收用户消息，经 ThreadStore/UserStore 管理会话与用户，并通过外脑受限工具与内脑交互。

<!-- 2026-03-07T16:30:04.063Z -->
[事实] read_file 仅允许访问 workDir 与 tempDir；若需读取上级目录文件，可使用 shell_exec cat（如 cat ../src/cli/index.ts），输出会保存到 .tool-outputs/。

<!-- 2026-03-07T16:34:12.073Z -->
[事实] openKuroneko 的 agent_id 通过 SHA256(MAC + absolutePath).slice(0,16) 计算，不同工作目录产生不同 agent_id，天然支持多实例隔离

<!-- 2026-03-07T16:34:12.074Z -->
[事实] openKuroneko 的路径排他锁机制（acquirePathLock）确保同一路径只能运行一个 agent 实例，复制实例必须使用不同的工作目录

<!-- 2026-03-07T16:34:12.074Z -->
[事实] openKuroneko 的认知状态完全存储在 .brain/ 目录下（goal/milestones/constraints/knowledge/skills/controller-state），复制该目录即可复制内脑状态

<!-- 2026-03-07T16:34:12.074Z -->
[事实] openKuroneko 的外脑通过 InnerBrainManager 管理 PID 文件（<obDir>/inner-brain.pid），支持跨进程重启后的进程状态恢复
