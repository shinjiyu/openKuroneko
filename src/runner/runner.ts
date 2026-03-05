import type { RunnerContext, RunnerDeps } from './index.js';

export interface Runner {
  run(userMessage?: string): Promise<void>;
}

export function createRunner(ctx: RunnerContext, deps: RunnerDeps): Runner {
  const { agentId, soul, workDir } = ctx;
  const { llm, ioRegistry, toolRegistry, memory, mem0, logger } = deps;

  return {
    async run(userMessage?: string): Promise<void> {
      const round = Date.now();
      logger.info('runner', { event: 'rcam.start', data: { round, mode: userMessage ? 'input' : 'control', preview: userMessage?.slice(0, 80) } });

      // ── R: Retrieval ──────────────────────────────────────────
      const input = userMessage ?? (await ioRegistry.getInput('default')?.read()) ?? null;
      const dailyLog = memory.readDailyLog();
      const tasks = memory.readTasks();
      const mem0Results = input
        ? await mem0.search(input, agentId)
        : [];

      // ── C: Cognition (ReCAP + LLM) ────────────────────────────
      const systemPrompt = buildSystemPrompt(soul, workDir, dailyLog, tasks, mem0Results);
      const messages: import('../adapter/index.js').Message[] = input
        ? [{ role: 'user', content: input }]
        : [{ role: 'user', content: '[SCL control prompt: no input. Review TASKS, plan next action.]' }];

      logger.info('runner', { event: 'rcam.cognition', data: { inputLen: input?.length ?? 0 } });

      const result = await llm.chat(systemPrompt, messages, toolRegistry.schema());

      // ── A: Action (tool calls) ─────────────────────────────────
      for (const toolCall of result.toolCalls ?? []) {
        const tool = toolRegistry.get(toolCall.name);
        if (!tool) {
          logger.warn('runner', { event: 'tool.unknown', data: { name: toolCall.name } });
          continue;
        }
        logger.info('runner', { event: 'tool.call', data: { name: toolCall.name, args: toolCall.args } });
        const toolResult = await tool.call(toolCall.args);
        logger.info('runner', { event: 'tool.result', data: { name: toolCall.name, ok: toolResult.ok, preview: toolResult.output.slice(0, 120) } });
      }

      // ── M: Memory ─────────────────────────────────────────────
      if (result.content) {
        memory.appendDailyLog(result.content);
        await mem0.add(result.content, agentId);
      }

      logger.info('runner', { event: 'rcam.end', data: { round, durationMs: Date.now() - round } });
    },
  };
}

function buildSystemPrompt(
  soul: string,
  workDir: string,
  dailyLog: string,
  tasks: string,
  mem0Results: string[]
): string {
  return [
    soul ? `## Soul\n${soul}` : '',
    `## Working Directory\n${workDir}`,
    dailyLog ? `## Today's Log\n${dailyLog}` : '',
    tasks ? `## TASKS\n${tasks}` : '',
    mem0Results.length > 0 ? `## Relevant Memory\n${mem0Results.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
}
