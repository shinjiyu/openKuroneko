# 内脑设计验证实验方案

版本：1.0  
覆盖：Controller 状态机、循环里程碑、SLEEPING、BLOCKED 解封、push-loop 事件处理

---

## 实验环境准备

```bash
# 启动内脑（单实例，使用 once 或 fast 模式均可）
node dist/cli/index.js --dir ./test-agent --loop fast

# 观察日志
tail -f /tmp/openkuroneko/<agent-id>/logs/$(date +%Y-%m-%d).jsonl | jq .

# 观察 status
watch -n 1 'cat /tmp/openkuroneko/<agent-id>/status'
```

每个实验前需清空 `.brain/` 并重置 controller-state.json：
```bash
rm -rf ./test-agent/.brain && mkdir -p ./test-agent/.brain
echo '{}' > ./test-agent/.brain/controller-state.json
```

---

## 实验 1：基础线性任务完成流程

**目标**：验证 DECOMPOSE → EXECUTE → ATTRIBUTE → SUCCESS_AND_NEXT → COMPLETE 完整路径。

**输入 goal.md**：
```
把斐波那契数列前10项写入 fib.txt 文件。
```

**预期行为**：
1. Decomposer 生成 1-2 个里程碑（如：计算斐波那契数列、写入文件）
2. Executor 调用 `write_file` 或 `shell_exec` 工具
3. Attributor 返回 `SUCCESS_AND_NEXT` → `COMPLETE`
4. output 文件写入 `{"type":"COMPLETE",...}`
5. `fib.txt` 存在且内容正确

**验证命令**：
```bash
cat ./test-agent/fib.txt
cat /tmp/openkuroneko/<id>/output | python3 -c "import sys,json; [print(json.loads(l)) for l in sys.stdin]"
```

**通过标准**：fib.txt 包含正确数列，output 最后一条 type=COMPLETE。

---

## 实验 2：REPLAN 次数上限 → BLOCKED 升级

**目标**：验证连续 REPLAN 超过 max_replan 后正确进入 BLOCKED，而非死循环。

**输入 goal.md**：
```
访问一个不存在的内网地址 http://192.168.1.254/api/data 并返回数据。
max_replan: 3
```

**预期行为**：
1. Executor 尝试访问，失败
2. Attributor 返回 REPLAN
3. 经过 3 次 REPLAN → BLOCKED
4. log 有 `blocked` 事件，`replanCount = 4`
5. output 写入 `{"type":"BLOCK",...}`

**通过标准**：`replanCount = max_replan + 1`（即 4），mode = BLOCKED，output 有 BLOCK 事件。

---

## 实验 3：BLOCKED 解封后 replanCount 必须归零（修复验证）

**目标**：验证解封后 replanCount 归零，不会立即再次触发 BLOCKED 死锁。

**步骤**：
1. 用实验 2 的场景让内脑进入 BLOCKED
2. 向 input 发送解封消息：
   ```bash
   echo "请改为从文件 ./local-data.json 读取数据" > /tmp/openkuroneko/<id>/input
   ```
3. 同时创建文件：`echo '{"data":42}' > ./test-agent/local-data.json`

**预期行为**：
- 解封后 `replanCount` 重置为 0（查看 controller-state.json）
- 内脑进入 DECOMPOSE 或 EXECUTE，而不是立即再次 BLOCKED

**验证命令**：
```bash
cat ./test-agent/.brain/controller-state.json | jq '.replanCount'
# 应输出 0
```

**通过标准**：replanCount = 0，mode 为 DECOMPOSE 或 EXECUTE，不出现二次 BLOCKED。

---

## 实验 4：循环里程碑基础功能（短周期）

**目标**：验证 CYCLE_DONE → SLEEPING → 定时唤醒 → 再次 EXECUTE 的完整循环。

**输入 goal.md**：
```
每 30 秒记录一次当前时间到 time-log.txt，共记录 3 次后停止。
max_cycles: 3
```

**预期 milestones.md（Decomposer 生成）**：
```
[M1] [Active] [cyclic:30000] 定时记录 — 将当前时间追加写入 time-log.txt | 已记录 3 次后终止
[M2] [Pending] 完成汇报 — 输出最终记录数统计
```

**预期事件序列**：
```
EXECUTE (第1轮) → write_file → ATTRIBUTE → CYCLE_DONE → SLEEPING (30s)
EXECUTE (第2轮) → write_file → ATTRIBUTE → CYCLE_DONE → SLEEPING (30s)
EXECUTE (第3轮) → write_file → ATTRIBUTE → SUCCESS_AND_NEXT → EXECUTE M2 → COMPLETE
```

**验证命令**：
```bash
wc -l ./test-agent/time-log.txt   # 应为 3
grep cycle_count /tmp/openkuroneko/<id>/logs/*.jsonl | jq .
```

**通过标准**：
- time-log.txt 有 3 行（非更多）
- 日志有 3 条 `cycle.sleeping` 事件（其中第 3 条之后有 SUCCESS_AND_NEXT）
- controller-state.json 最终 cycleCount = 3，mode = BLOCKED（完成后等待新目标）

---

## 实验 5：max_cycles 保护

**目标**：验证循环里程碑超过 max_cycles 时自动 BLOCKED，不无限运行。

**输入 goal.md**：
```
每分钟检查网络状态并记录。
max_cycles: 2
```

**步骤**：将 cycleIntervalMs 在测试时改为 5000（5 秒）方便观察：
```
[M1] [Active] [cyclic:5000] 网络检查 — ping 8.8.8.8 并记录结果
```

**预期行为**：
- 第 2 轮 CYCLE_DONE 后，cycleCount = 2
- 第 3 轮本应执行，但 Controller 检测到 cycleCount > maxCycles，直接 BLOCKED
- log 有 `cycle_done.max_cycles_exceeded` 事件

**通过标准**：日志出现 `max_cycles_exceeded`，mode = BLOCKED，cycleCount = 3（超限值）。

---

## 实验 6：SLEEPING 被外脑 input 提前唤醒

**目标**：验证 SLEEPING 状态下收到外部 input 能立即唤醒并进入 DECOMPOSE。

**步骤**：
1. 用实验 4 的场景，内脑进入 SLEEPING（等待 30s）
2. 在 10 秒内向 input 发送新指令：
   ```bash
   echo "任务有变化，请改为每 10 秒记录一次" > /tmp/openkuroneko/<id>/input
   ```

**预期行为**：
- 内脑 tick 检测到 input，立即从 SLEEPING 唤醒
- mode 变为 DECOMPOSE（重新规划）
- sleepUntil 被清空
- 日志有 `sleep.interrupted` 事件

**通过标准**：睡眠未满 30s 被打断，日志有 `sleep.interrupted`，模式为 DECOMPOSE。

---

## 实验 7：push-loop 多事件批量处理（修复验证）

**目标**：验证同一批次内的多条事件（PROGRESS + BLOCK）都能正确处理，不丢失。

**模拟方式**：直接向 output 文件追加两条事件，然后等待 push-loop 的 tick：

```bash
OUTPUT=/tmp/openkuroneko/<id>/output

# 模拟内脑连续写入两条事件
echo '{"type":"PROGRESS","message":"第一阶段完成","ts":"2026-03-08T00:00:01Z"}' >> $OUTPUT
echo '{"type":"BLOCK","message":"需要人工确认API密钥","question":"请提供密钥","ts":"2026-03-08T00:00:02Z"}' >> $OUTPUT
```

**预期行为**：
- push-loop 在同一 tick 读到两行内容
- PROGRESS 事件被记录到日志
- BLOCK 事件触发 BlockEscalationManager，用户收到通知

**通过标准**：日志有两条 `inner_output` 事件（类型分别为 PROGRESS 和 BLOCK），用户通道收到 BLOCK 通知。

---

## 实验 8：外脑重启后 push-loop offset 不重放（修复验证）

**目标**：验证外脑重启后不重复处理已有 output 事件。

**步骤**：
1. 运行完实验 1，output 文件有 COMPLETE 事件
2. 记录当前 output 文件大小
3. 重启外脑进程
4. 等待 5 秒，观察是否重发 COMPLETE 通知

**验证命令**：
```bash
# 检查 offset 文件是否存在
ls /tmp/openkuroneko/<id>/output.ob.offset
cat /tmp/openkuroneko/<id>/output.ob.offset  # 应等于 output 文件大小
```

**通过标准**：重启后不向用户重发 COMPLETE，`output.ob.offset` 文件值 = output 文件大小。

---

## 实验 9：Executor 工具循环 MAX_ROUNDS 保护

**目标**：验证 Executor 在异常情况下不会无限循环。

**方法**：（需要临时修改 MAX_EXEC_ROUNDS = 3 进行测试）

给内脑一个让 LLM 倾向于持续工具调用的任务（如让它反复搜索然后持续处理），观察是否在 3 轮后强制退出并记录 `llm.max_rounds` 警告。

**通过标准**：日志出现 `llm.max_rounds`，Executor 正常退出并进入 ATTRIBUTE 阶段（不崩溃）。

---

## 实验 10：里程碑格式损坏检测

**目标**：验证 milestones.md 含有格式错误行时有 warn 日志，不静默丢弃。

**操作**：在 milestones.md 中插入格式错误行：
```bash
echo "[M99] [Active] 这行格式不对没有破折号" >> ./test-agent/.brain/milestones.md
```

**预期行为**：
- 下一轮 tick 日志出现 `milestone.parse.failed` warn 事件
- 该行被跳过，其他正常里程碑继续处理

**通过标准**：日志有 `milestone.parse.failed`，内脑不崩溃，有效里程碑正常工作。

---

## 实验执行建议

| 顺序 | 实验 | 耗时预估 | 优先级 |
|---|---|---|---|
| 1 | 实验 1：基础完成流程 | 5 min | 必做（基线） |
| 2 | 实验 2：REPLAN 上限 | 10 min | 必做 |
| 3 | 实验 3：BLOCKED 解封不死锁 | 5 min | 必做（修复验证） |
| 4 | 实验 7：多事件批量处理 | 3 min | 必做（修复验证） |
| 5 | 实验 8：重启 offset 不重放 | 5 min | 必做（修复验证） |
| 6 | 实验 4：循环里程碑基础 | 15 min | 重要 |
| 7 | 实验 5：max_cycles 保护 | 5 min | 重要 |
| 8 | 实验 6：SLEEPING 提前唤醒 | 5 min | 重要 |
| 9 | 实验 9：MAX_ROUNDS 保护 | 5 min | 可选 |
| 10 | 实验 10：格式损坏检测 | 2 min | 可选 |

---

## 已知遗留问题（不在本批实验范围）

| 问题 | 严重度 | 说明 |
|---|---|---|
| executor.ts `_outputSeq` 重启归零可能覆盖旧 .tool-outputs 文件 | HIGH | 建议改用时间戳前缀 |
| block-resolver 缺少 milestone/goal 上下文 | MEDIUM | 影响 CONTINUE/REPLAN 决策质量 |
| skills.md 无淘汰机制，长期增长 | MEDIUM | 建议支持 `max_skills: N` 或 LRU |
| archiveForNewTask 不归档 goal.md | MEDIUM | 历史目标无法追溯 |
| push-loop handleBlock fire-and-forget，重启后 pending BLOCK 升级丢失 | MEDIUM | 需要持久化升级状态 |
| scheduler 30s 轮询在 SLEEPING 期间无效 | MEDIUM | 理想方案是精准 timer |
| runner.ts 死代码 | LOW | 建议清除 |
