import fs from 'fs';
import path from 'path';
import type { Message, LLMResult } from '../adapter/index.js';
import type { RunnerContext, RunnerDeps } from './index.js';
import { readPendingGaps } from '../tools/definitions/capability-gap.js';
import type { CapabilityGapRecord } from '../tools/definitions/capability-gap.js';


// ── Context-window management ─────────────────────────────────────────────────
/**
 * Token budget for chat history. Conservative: leaves ~4k for system prompt,
 * tools schema, and model response within a typical 16k context window.
 * Increase if using a model with a larger context (e.g. 32k / 128k).
 */
const CONTEXT_HISTORY_TOKEN_LIMIT = 8000;

/**
 * Fraction of the token budget at which proactive compression is triggered.
 * Compression runs *before* the window is full so the LLM always has
 * breathing room and compression itself doesn't overflow the context.
 */
const COMPRESS_THRESHOLD = 0.75; // compress at 75% full

/**
 * Number of oldest messages taken per compression pass.
 * Must be even to keep user/assistant pairs intact.
 */
const COMPRESS_CHUNK_SIZE = 10;

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

  // In-memory conversation history — persists across ticks within this session
  const chatHistory: Message[] = [];

  // Tracks context archive files written to workDir during this session
  const contextArchives: string[] = [];

  return {
    async run(): Promise<RunResult> {
      const round = Date.now();

      // ── R: Retrieval ─────────────────────────────────────────────────
      const rawInput    = await safeReadInput(ioRegistry, logger);
      const tasks       = memory.readTasks();
      const pendingGaps = readPendingGaps(ctx.tempDir);

      // Fast-path idle guard: nothing to do → skip LLM entirely, let scheduler back off
      if (!rawInput && !tasks.trim() && pendingGaps.length === 0) {
        return { hadWork: false };
      }

      const dailyLog    = memory.readDailyLog();
      const mem0Results = rawInput
        ? await safeMem0Search(mem0, rawInput, agentId, logger)
        : [];

      const soul = ctx.soul; // hot-reload: caller updates ctx.soul each tick

      logger.info('runner', {
        event: 'rcam.start',
        data: { round, hasInput: !!rawInput, mem0Hits: mem0Results.length, pendingGaps: pendingGaps.length, historyLen: chatHistory.length },
      });

      // ── C: Cognition — build system prompt (ReCAP context) ───────────
      const systemPrompt = buildSystemPrompt(soul, workDir, dailyLog, tasks, mem0Results, pendingGaps, contextArchives);

      // Build message list for LLM
      let messages: Message[];
      if (rawInput) {
        chatHistory.push({ role: 'user', content: rawInput });

        // Proactive compression: run *before* the context is full so the
        // compressor LLM call itself has enough headroom.
        const historyTokens = estimateTokens(chatHistory);
        if (historyTokens >= CONTEXT_HISTORY_TOKEN_LIMIT * COMPRESS_THRESHOLD) {
          logger.info('runner', {
            event: 'context.compress.trigger',
            data: { historyTokens, threshold: Math.floor(CONTEXT_HISTORY_TOKEN_LIMIT * COMPRESS_THRESHOLD) },
          });
          const chunk = chatHistory.splice(0, COMPRESS_CHUNK_SIZE);
          const archivePath = await compressAndArchive(chunk, workDir, llm, logger);
          if (archivePath) contextArchives.push(archivePath);
        }

        messages = [...chatHistory];
      } else {
        messages = [{ role: 'user', content: SCL_CONTROL_PROMPT }];
      }

      // ── A: Action — multi-round tool-call loop ───────────────────────
      let toolCallCount = 0;
      let lastContent = '';
      let currentMessages = [...messages];

      for (let round_t = 0; ; round_t++) {
        logger.info('runner', { event: 'llm.call', data: { round_t } });

        let result: LLMResult;
        try {
          result = await llm.chat(systemPrompt, currentMessages, toolRegistry.schema());
        } catch (e) {
          logger.error('runner', { event: 'llm.error', data: { error: String(e) } });
          // Only surface errors to master when there was actual user input
          if (rawInput) await writeError(ioRegistry, String(e), logger);
          return { hadWork: !!rawInput };
        }

        lastContent = result.content ?? '';

        if (!result.toolCalls || result.toolCalls.length === 0) {
          // LLM finished — no more tools to call
          logger.info('runner', { event: 'llm.done', data: { contentLen: lastContent.length } });
          break;
        }

        // Assistant 消息必须带 tool_calls（含 id），否则 API 报 tool_call_id is not found
        const toolResultMessages: Message[] = [
          {
            role: 'assistant',
            content: lastContent,
            tool_calls: result.toolCalls!.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.args) },
            })),
          },
        ];

        for (const tc of result.toolCalls) {
          toolCallCount++;
          const tool = toolRegistry.get(tc.name);

          if (!tool) {
            logger.warn('runner', { event: 'tool.unknown', data: { name: tc.name } });
            toolResultMessages.push({
              role: 'tool',
              content: JSON.stringify({ ok: false, output: `Unknown tool: ${tc.name}` }),
              tool_call_id: tc.id,
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
            tool_call_id: tc.id,
          });
        }

        // Continue conversation with tool results
        currentMessages = [...currentMessages, ...toolResultMessages];
      }

      // ── Output: if this round had user input and LLM produced content, write to output ──
      if (rawInput && lastContent) {
        try {
          const ep = ioRegistry.getOutput('default');
          if (ep) {
            await ep.write(lastContent);
            logger.info('io', { event: 'output.write', data: { endpointId: 'default', preview: lastContent.slice(0, 80) } });
          }
        } catch (e) {
          logger.warn('runner', { event: 'output.write.error', data: { error: String(e) } });
        }
        chatHistory.push({ role: 'assistant', content: lastContent });
      }

      // ── M: Memory ────────────────────────────────────────────────────
      const agentReplyContent = rawInput && lastContent ? lastContent : null;

      if (rawInput || agentReplyContent) {
        const logEntry = [
          rawInput          ? `[User] ${rawInput}` : null,
          agentReplyContent ? `[Agent] ${agentReplyContent}` : null,
        ].filter(Boolean).join('\n');

        memory.appendDailyLog(logEntry);
        logger.debug('runner', { event: 'memory.dailyLog.append', data: { len: logEntry.length } });

        if (agentReplyContent) {
          await safeMem0Add(mem0, logEntry, agentId, logger);
        }
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

/**
 * Estimate token count for a message list.
 * Heuristic: ~3 characters per token for Chinese/English mixed text.
 */
function estimateTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 3), 0);
}

/**
 * Compress a chunk of messages using the LLM, then write a single archive file
 * containing both the LLM-generated summary (for quick recall) and the raw
 * messages (for exact reference). Returns the relative filename or null.
 *
 * Falls back to raw-only archiving if the LLM call fails.
 */
async function compressAndArchive(
  chunk: Message[],
  workDir: string,
  llm: RunnerDeps['llm'],
  logger: RunnerDeps['logger'],
): Promise<string | null> {
  const SUMMARIZE_SYSTEM =
    'You are a memory consolidation assistant. ' +
    'Summarize the following conversation segment concisely, in the same language used by the participants. ' +
    'Capture: key decisions, facts established, files created or modified, tasks completed, and any important context. ' +
    'Output ONLY the summary text, no preamble or meta-commentary.';

  const rawText = chunk
    .map(m => `[${m.role}]\n${m.content}`)
    .join('\n\n---\n\n');

  let summary: string | null = null;
  try {
    const result = await llm.chat(
      SUMMARIZE_SYSTEM,
      [{ role: 'user', content: rawText }],
      [], // no tools needed for summarization
    );
    summary = result.content?.trim() ?? null;
    logger.info('runner', { event: 'context.compress.summary', data: { summaryLen: summary?.length ?? 0 } });
  } catch (e) {
    logger.warn('runner', { event: 'context.compress.llm.failed', data: { error: String(e) } });
  }

  try {
    fs.mkdirSync(workDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `context-archive-${ts}.md`;
    const absPath = path.join(workDir, filename);

    const sections: string[] = [
      `# Context Archive — ${new Date().toLocaleString()}`,
      `**Messages compressed:** ${chunk.length}`,
      '',
      '## Summary',
      summary ?? '*(summarization failed — see raw messages below)*',
      '',
      '## Raw Messages',
      rawText,
    ];
    fs.writeFileSync(absPath, sections.join('\n'), 'utf8');
    logger.info('runner', { event: 'context.archived', data: { file: filename, messages: chunk.length, hasSummary: !!summary } });
    return filename;
  } catch (e) {
    logger.warn('runner', { event: 'context.archive.failed', data: { error: String(e) } });
    return null;
  }
}

function buildSystemPrompt(
  soul: string,
  workDir: string,
  dailyLog: string,
  tasks: string,
  mem0Results: string[],
  pendingGaps: CapabilityGapRecord[],
  contextArchives: string[]
): string {
  const sections: string[] = [];
  if (soul)                    sections.push(`## Soul\n${soul}`);
  sections.push(`## Working Directory\n${workDir}`);
  if (contextArchives.length > 0) {
    const refs = contextArchives.map(f => `- ${f}  →  use read_file to retrieve`).join('\n');
    sections.push(`## Archived Context\nEarlier conversation has been archived. Use read_file on these files if you need historical context:\n${refs}`);
  }
  if (dailyLog)                sections.push(`## Today's Log\n${dailyLog}`);
  if (tasks)                   sections.push(`## TASKS\n${tasks}`);
  if (mem0Results.length > 0)  sections.push(`## Relevant Memory\n${mem0Results.join('\n')}`);
  if (pendingGaps.length > 0) {
    const gapLines = pendingGaps.map(g => `- [${g.ts}] ${g.gap}${g.reason ? ` (${g.reason})` : ''}`).join('\n');
    sections.push(`## Pending Capability Gaps (self-bootstrap these)\n${gapLines}`);
  }
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
