import type { Message, LLMResult } from '../adapter/index.js';
import type { RunnerContext, RunnerDeps } from './index.js';

const MAX_TOOL_ROUNDS = 10; // 防止工具调用死循环

export interface RunResult {
  /** true = 本轮有实际 input 或工具调用；false = 纯空转 */
  hadWork: boolean;
}

export interface Runner {
  run(): Promise<RunResult>;
}

export function createRunner(ctx: RunnerContext, deps: RunnerDeps): Runner {
  const { agentId, workDir } = ctx;
  const { llm, ioRegistry, toolRegistry, memory, mem0, logger } = deps;

  return {
    async run(): Promise<RunResult> {
      const round = Date.now();

      // ── R: Retrieval ─────────────────────────────────────────────────
      const rawInput = await safeReadInput(ioRegistry, logger);
      const dailyLog  = memory.readDailyLog();
      const tasks     = memory.readTasks();
      const mem0Results = rawInput
        ? await safeMem0Search(mem0, rawInput, agentId, logger)
        : [];

      const soul = ctx.soul; // hot-reload: caller updates ctx.soul each tick

      logger.info('runner', {
        event: 'rcam.start',
        data: { round, hasInput: !!rawInput, mem0Hits: mem0Results.length },
      });

      // ── C: Cognition — build system prompt (ReCAP context) ───────────
      const systemPrompt = buildSystemPrompt(soul, workDir, dailyLog, tasks, mem0Results);

      const messages: Message[] = rawInput
        ? [{ role: 'user', content: rawInput }]
        : [{ role: 'user', content: SCL_CONTROL_PROMPT }];

      // ── A: Action — multi-round tool-call loop ───────────────────────
      let toolCallCount = 0;
      let lastContent = '';
      let currentMessages = [...messages];

      for (let round_t = 0; round_t < MAX_TOOL_ROUNDS; round_t++) {
        logger.info('runner', { event: 'llm.call', data: { round_t } });

        let result: LLMResult;
        try {
          result = await llm.chat(systemPrompt, currentMessages, toolRegistry.schema());
        } catch (e) {
          logger.error('runner', { event: 'llm.error', data: { error: String(e) } });
          await writeError(ioRegistry, String(e), logger);
          return { hadWork: !!rawInput };
        }

        lastContent = result.content ?? '';

        if (!result.toolCalls || result.toolCalls.length === 0) {
          // LLM finished — no more tools to call
          logger.info('runner', { event: 'llm.done', data: { contentLen: lastContent.length } });
          break;
        }

        // Execute each tool call and collect results
        const toolResultMessages: Message[] = [
          { role: 'assistant', content: lastContent },
        ];

        for (const tc of result.toolCalls) {
          toolCallCount++;
          const tool = toolRegistry.get(tc.name);

          if (!tool) {
            logger.warn('runner', { event: 'tool.unknown', data: { name: tc.name } });
            toolResultMessages.push({
              role: 'tool',
              content: JSON.stringify({ ok: false, output: `Unknown tool: ${tc.name}` }),
            });
            continue;
          }

          logger.info('runner', {
            event: 'tool.call',
            data: { name: tc.name, args: redactArgs(tc.args) },
          });

          const toolResult = await tool.call(tc.args);

          logger.info('runner', {
            event: 'tool.result',
            data: { name: tc.name, ok: toolResult.ok, preview: toolResult.output.slice(0, 120) },
          });

          toolResultMessages.push({
            role: 'tool',
            content: JSON.stringify({ ok: toolResult.ok, output: toolResult.output }),
          });
        }

        // Continue conversation with tool results
        currentMessages = [...currentMessages, ...toolResultMessages];
      }

      // ── M: Memory ────────────────────────────────────────────────────
      if (lastContent) {
        memory.appendDailyLog(lastContent);
        logger.debug('runner', { event: 'memory.dailyLog.append', data: { len: lastContent.length } });

        await safeMem0Add(mem0, lastContent, agentId, logger);
      }

      const hadWork = !!rawInput || toolCallCount > 0;
      logger.info('runner', {
        event: 'rcam.end',
        data: { round, durationMs: Date.now() - round, toolCallCount, hadWork },
      });

      return { hadWork };
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SCL_CONTROL_PROMPT =
  '[SCL control prompt] No new input. Review your TASKS and Daily Log. ' +
  'Decide your next action: continue a task, self-reflect, or idle if nothing is pending.';

function buildSystemPrompt(
  soul: string,
  workDir: string,
  dailyLog: string,
  tasks: string,
  mem0Results: string[]
): string {
  const sections: string[] = [];
  if (soul)                    sections.push(`## Soul\n${soul}`);
  sections.push(`## Working Directory\n${workDir}`);
  if (dailyLog)                sections.push(`## Today's Log\n${dailyLog}`);
  if (tasks)                   sections.push(`## TASKS\n${tasks}`);
  if (mem0Results.length > 0)  sections.push(`## Relevant Memory\n${mem0Results.join('\n')}`);
  return sections.join('\n\n---\n\n');
}

async function safeReadInput(
  ioRegistry: RunnerDeps['ioRegistry'],
  logger: RunnerDeps['logger']
): Promise<string | null> {
  try {
    const ep = ioRegistry.getInput('default');
    if (!ep) return null;
    const content = await ep.read();
    if (content) {
      logger.info('io', { event: 'input.read', data: { endpointId: 'default', preview: content.slice(0, 80) } });
    }
    return content;
  } catch (e) {
    logger.error('io', { event: 'input.read.error', data: { error: String(e) } });
    return null;
  }
}

async function writeError(
  ioRegistry: RunnerDeps['ioRegistry'],
  error: string,
  logger: RunnerDeps['logger']
): Promise<void> {
  try {
    const ep = ioRegistry.getOutput('default');
    if (!ep) return;
    await ep.write(`[ERROR] ${error}`);
    logger.info('io', { event: 'output.write', data: { endpointId: 'default', type: 'error' } });
  } catch (e) {
    logger.error('io', { event: 'output.write.error', data: { error: String(e) } });
  }
}

async function safeMem0Search(
  mem0: RunnerDeps['mem0'],
  query: string,
  agentId: string,
  logger: RunnerDeps['logger']
): Promise<string[]> {
  try {
    return await mem0.search(query, agentId);
  } catch (e) {
    logger.warn('mem0', { event: 'search.error', data: { error: String(e) } });
    return [];
  }
}

async function safeMem0Add(
  mem0: RunnerDeps['mem0'],
  content: string,
  agentId: string,
  logger: RunnerDeps['logger']
): Promise<void> {
  try {
    await mem0.add(content, agentId);
    logger.debug('mem0', { event: 'add', data: { len: content.length } });
  } catch (e) {
    logger.warn('mem0', { event: 'add.error', data: { error: String(e) } });
  }
}

/** 从工具参数中隐去敏感字段（如 content 过长时截断） */
function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && v.length > 200) {
      out[k] = v.slice(0, 200) + '…';
    } else {
      out[k] = v;
    }
  }
  return out;
}
