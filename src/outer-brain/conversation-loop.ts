/**
 * 外脑对话 Loop
 *
 * 职责：
 * - 接收单条 InboundMessage
 * - 构建 LLM 上下文（soul + thread history + user memory + inner status）
 * - 调用 LLM，支持工具调用（外脑受限工具集）
 * - 将 LLM 回复写回 thread history，并通过 reply_to_user 工具发送
 *
 * 上下文构建策略（DM）：
 *   1. soul.md 系统提示
 *   2. 当前 inner status 摘要（只读）
 *   3. 用户记忆摘要（mem0，可选）
 *   4. 当前 thread 历史（最近 N 条）
 *   5. 当前消息
 *
 * 上下文构建策略（Group）：
 *   1. soul.md 系统提示
 *   2. 当前 inner status 摘要
 *   3. 群组滚动摘要
 *   4. 最近群聊历史（N 条）
 *   5. 当前消息
 *   注意：其他群的历史通过 search_thread 工具查询，不注入上下文
 */

import type { LLMAdapter, Message, ContentBlock } from '../adapter/index.js';
import type { InboundMessage, InnerBrainStatus } from '../channels/types.js';
import type { ChannelRegistry } from '../channels/registry.js';
import type { ThreadStore } from '../threads/store.js';
import type { UserStore } from '../users/store.js';
import type { SoulConfig } from './soul.js';
import type { ObTool } from './tools/types.js';
import { buildToolDef } from './tools/types.js';
import type { Logger } from '../logger/index.js';

const MAX_TOOL_ROUNDS = 6;
const HISTORY_CONTEXT_LIMIT = 20; // 注入 LLM 的最大历史条数

export interface ConversationLoopDeps {
  llm:             LLMAdapter;
  threadStore:     ThreadStore;
  userStore:       UserStore;
  channelRegistry: ChannelRegistry;
  tools:           ObTool[];
  logger:          Logger;
  /** 读取内脑当前状态（外部提供，避免重复 IO） */
  getInnerStatus: () => InnerBrainStatus | null;
}

export class ConversationLoop {
  private readonly deps: ConversationLoopDeps;

  constructor(deps: ConversationLoopDeps) {
    this.deps = deps;
  }

  /**
   * 处理一条入站消息，返回外脑的文字回复（已通过 reply_to_user 工具发送）。
   * 如果无需回复（群聊沉默决策），返回 null。
   */
  async process(msg: InboundMessage, soul: SoulConfig): Promise<string | null> {
    const { llm, threadStore, channelRegistry, logger, tools } = this.deps;

    // 记录入站消息到 thread 历史
    threadStore.getOrCreate(msg);
    threadStore.appendUser(msg.thread_id, msg.user_id, msg.content, msg.ts);

    // 读取内脑状态（用于权限规则注入）
    const innerStatus = this.deps.getInnerStatus();

    // 构建系统提示
    const systemPrompt = buildSystemPrompt(soul, msg, threadStore, innerStatus);

    // 构建消息历史
    const messages = buildMessages(msg, threadStore, this.deps, soul);

    logger.info('outer-brain', {
      event: 'loop.start',
      data: { thread: msg.thread_id, user: msg.user_id, content: msg.content.slice(0, 80) },
    });

    // ── Tool-calling loop ──────────────────────────────────────────────────
    const toolDefs = tools.map(buildToolDef);

    let round = 0;
    let currentMessages = messages;
    let finalReply: string | null = null;

    while (round < MAX_TOOL_ROUNDS) {
      round++;

      const result = await llm.chat(systemPrompt, currentMessages, toolDefs);

      if (result.toolCalls && result.toolCalls.length > 0) {
        // 执行工具调用；assistant 消息必须带 tool_calls（含 id），否则 API 报 tool_call_id is not found
        const assistantMsg: Message = {
          role: 'assistant',
          content: result.content || '',
          tool_calls: result.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        };
        currentMessages = [...currentMessages, assistantMsg];

        for (const tc of result.toolCalls) {
          logger.info('outer-brain', {
            event: 'tool.call',
            data: { name: tc.name, args: truncateArgs(tc.args) },
          });

          const tool = tools.find((t) => t.name === tc.name);
          let output: string;

          if (tool) {
            const res = await tool.call(tc.args);
            output = res.output;
          } else {
            output = `工具 ${tc.name} 不存在`;
          }

          logger.info('outer-brain', {
            event: 'tool.result',
            data: { name: tc.name, preview: output.slice(0, 120) },
          });

          currentMessages = [
            ...currentMessages,
            { role: 'tool', content: `[${tc.name}] ${output}`, tool_call_id: tc.id },
          ];
        }
        continue;
      }

      // 没有 tool call → LLM 直接回复
      finalReply = result.content.trim() || null;
      break;
    }

    if (finalReply) {
      logger.info('outer-brain', {
        event: 'loop.send',
        data: { thread: msg.thread_id, content_len: finalReply.length, preview: finalReply.slice(0, 80) },
      });
      // 发送回复到对应频道
      try {
        await channelRegistry.send({ thread_id: msg.thread_id, content: finalReply });
      } catch (e) {
        logger.error('outer-brain', {
          event: 'loop.send_error',
          data: { thread: msg.thread_id, error: String(e) },
        });
      }

      // 记录外脑回复到 thread 历史
      threadStore.appendAssistant(msg.thread_id, finalReply, Date.now());

      logger.info('outer-brain', {
        event: 'loop.reply',
        data: { thread: msg.thread_id, reply: finalReply.slice(0, 120) },
      });
    }

    return finalReply;
  }
}

// ── 上下文构建 ───────────────────────────────────────────────────────────────

function buildSystemPrompt(
  soul: SoulConfig,
  msg: InboundMessage,
  threadStore: ThreadStore,
  innerStatus?: import('../channels/types.js').InnerBrainStatus | null,
): string {
  const isGroup = msg.thread_id.includes(':group:');
  const statusDesc = isGroup ? '群聊对话' : '私信对话';

  // 注入所有已知 thread（显示人类可读名称 + 精确 thread_id）
  const knownThreads = threadStore.listThreadsWithNames();
  const threadList = knownThreads.length > 0
    ? `\n【已知对话频道】（查询历史时必须使用括号内的精确 thread_id）\n` +
      knownThreads.map(({ thread_id, display_name }) => `- ${display_name}（${thread_id}）`).join('\n') +
      `\n使用 search_thread 时，thread_id 只能从上方列表中选取，不得猜测或自行构造。`
    : '';

  // ── 任务上下文（信息性，不用于硬性权限拦截）────────────────────────────
  const currentUser = msg.user_id;
  const taskOwner   = innerStatus?.goal_origin_user ?? null;

  const permissionRules = [
    `【当前用户】${currentUser}`,
    taskOwner ? `【当前内脑任务发起人】${taskOwner}` : `【当前内脑任务发起人】无（内脑未运行或尚无任务）`,
    ``,
    `【工具使用说明】`,
    `- 所有已注册用户均可派发新任务（set_goal）、停止内脑（stop_inner_brain）、发送指令（send_directive）`,
    `- 派发新任务前请先与用户确认目标内容，确认后再调用 set_goal`,
    `- 如需停止当前任务并重新派发，先调用 stop_inner_brain，再调用 set_goal`,
  ].join('\n');

  const groupReplyRule = isGroup
    ? `\n【群聊回复】当前是群聊，请尽量用简短内容回复（一两句、口语化即可），避免长段落和 1.2.3. 列表，像真人接话。需要展开时再展开。\n`
    : '';

  return `你是 ${soul.name}，${soul.persona}。
当前场景：${statusDesc}（thread: ${msg.thread_id}）
语言：${soul.language}${groupReplyRule}
${threadList}

${permissionRules}

【工具使用规则】
- 直接输出回复文本即可，框架会自动发送给用户
- 需要了解内脑状态时，先调用 read_inner_status 工具，再回复
- 转达用户指令给内脑时调用 send_directive 或 set_goal（set_goal 仅在明确开始新任务时）
- 查询其他频道历史记录时调用 search_thread，thread_id 必须从已知频道列表中选取
- 工具调用完成后，输出最终回复文本结束本轮对话

${soul.system_prompt_extra ? `【人设补充】\n${soul.system_prompt_extra}` : ''}`;
}

function buildMessages(
  msg: InboundMessage,
  threadStore: ThreadStore,
  deps: ConversationLoopDeps,
  soul: SoulConfig,
): Message[] {
  const messages: Message[] = [];
  const isGroup = msg.thread_id.includes(':group:');

  // 内脑状态摘要
  const innerStatus = deps.getInnerStatus();
  if (innerStatus) {
    const statusSummary = formatInnerStatus(innerStatus);
    messages.push({
      role: 'user',
      content: `[系统：内脑当前状态]\n${statusSummary}`,
    });
    messages.push({
      role: 'assistant',
      content: '已了解内脑状态。',
    });
  }

  // 群聊摘要（仅群聊注入）
  if (isGroup) {
    const thread = threadStore.getThread(msg.thread_id);
    if (thread?.group_summary) {
      messages.push({
        role: 'user',
        content: `[系统：群聊摘要]\n${thread.group_summary}`,
      });
      messages.push({
        role: 'assistant',
        content: '已了解群聊背景。',
      });
    }
  }

  // DM 时：注入与当前用户共同参与的群聊近期记录
  if (!isGroup) {
    const sharedGroups = threadStore.getSharedGroupThreads(msg.user_id);
    for (const group of sharedGroups) {
      const recentGroupHistory = threadStore.getHistory(group.thread_id).slice(-8);
      if (recentGroupHistory.length === 0) continue;

      const groupName = group.group_name ?? group.peer_id;
      const lines = recentGroupHistory.map((h) => {
        const who = h.role === 'user' ? (h.user_id ?? 'user') : soul.name;
        return `${who}: ${h.content}`;
      });

      messages.push({
        role: 'user',
        content: `[系统：群聊"${groupName}"（${group.thread_id}）近期记录]\n${lines.join('\n')}`,
      });
      messages.push({
        role: 'assistant',
        content: `已了解"${groupName}"群的近期对话。`,
      });
    }
  }

  // Thread 历史（最近 N 条，不包含当前消息）
  const history = threadStore.getHistory(msg.thread_id);
  const recentHistory = history.slice(-(HISTORY_CONTEXT_LIMIT + 1), -1); // 不含最新条

  for (const entry of recentHistory) {
    if (entry.role === 'user') {
      const who = entry.user_id ?? 'user';
      messages.push({ role: 'user', content: `[${who}] ${entry.content}` });
    } else {
      messages.push({ role: 'assistant', content: entry.content });
    }
  }

  // 当前消息（支持多模态：图片附件转为 image_url content block）
  const mention  = msg.is_mention ? '（@了你）' : '';
  const textPart = `[${msg.user_id}${mention}] ${msg.content}`;
  const imageAtts = (msg.attachments ?? []).filter(
    (a) => a.type === 'image' && a.url && (a.url.startsWith('data:') || a.url.startsWith('http')),
  );

  if (imageAtts.length > 0) {
    const blocks: ContentBlock[] = [{ type: 'text', text: textPart }];
    for (const img of imageAtts) {
      blocks.push({ type: 'image_url', image_url: { url: img.url!, detail: 'auto' } });
    }
    messages.push({ role: 'user', content: blocks });
  } else {
    messages.push({ role: 'user', content: textPart });
  }

  return messages;
}

function formatInnerStatus(status: InnerBrainStatus): string {
  const parts = [
    `模式：${status.mode}`,
    status.milestone ? `里程碑：${status.milestone.title}` : null,
    status.blocked ? `⚠️ BLOCKED：${status.block_reason ?? '未知原因'}` : '正常运行中',
    status.goal_origin_user ? `任务发起人：${status.goal_origin_user}` : null,
  ].filter(Boolean);
  return parts.join('\n');
}

function truncateArgs(args: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) => {
      const s = String(v);
      return [k, s.length > 80 ? s.slice(0, 80) + '…' : s];
    }),
  );
}
