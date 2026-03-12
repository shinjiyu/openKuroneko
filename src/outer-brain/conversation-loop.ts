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
import type { KnowledgeStore } from '../archive/index.js';
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

/**
 * 解析历史条目的发言者展示名。历史中可能存了渠道 raw id（如飞书 on_xxx/ou_xxx），
 * 而 userStore 的 key 是 feishu_on_xxx，需回退查询避免人名与 id 映错。
 */
function getDisplayNameForHistory(
  userStore: UserStore,
  threadId: string,
  userId: string | undefined,
): string {
  if (!userId) return 'user';
  const u = userStore.getUser(userId);
  if (u?.display_name) return u.display_name;
  if (threadId.startsWith('feishu:') && (userId.startsWith('on_') || userId.startsWith('ou_'))) {
    const canonical = userStore.getUser(`feishu_${userId}`);
    if (canonical?.display_name) return canonical.display_name;
  }
  return userId;
}

export interface ConversationLoopDeps {
  llm:             LLMAdapter;
  threadStore:     ThreadStore;
  userStore:       UserStore;
  channelRegistry: ChannelRegistry;
  tools:           ObTool[];
  logger:          Logger;
  /** 读取内脑当前状态（外部提供，避免重复 IO） */
  getInnerStatus: () => InnerBrainStatus | null;
  /** 当前渠道下 agent 展示名（如飞书应用名），若存在则覆盖 soul.name，便于区分「自己」 */
  getAgentDisplayName?: () => string | undefined;
  /** 全局知识库。提供后按用户消息检索相关历史知识并注入上下文，便于直接回答而不再派发内脑 */
  knowledgeStore?: KnowledgeStore;
}

export class ConversationLoop {
  private readonly deps: ConversationLoopDeps;

  constructor(deps: ConversationLoopDeps) {
    this.deps = deps;
  }

  /**
   * 处理一条入站消息，返回外脑的文字回复（已通过 reply_to_user 工具发送）。
   * 如果无需回复（群聊沉默决策），返回 null。
   * @param opts.skipAppendUser 为 true 时不再写入 thread（由调用方已写入，避免重复）
   */
  async process(msg: InboundMessage, soul: SoulConfig, opts?: { skipAppendUser?: boolean }): Promise<string | null> {
    const { llm, threadStore, channelRegistry, logger, tools } = this.deps;

    // 记录入站消息到 thread 历史（除非调用方已写入）
    if (!opts?.skipAppendUser) {
      threadStore.getOrCreate(msg);
      threadStore.appendUser(msg.thread_id, msg.user_id, msg.content, msg.ts);
    }

    // 读取内脑状态（用于权限规则注入）
    const innerStatus = this.deps.getInnerStatus();

    // 按用户消息检索全局知识库，便于基于历史任务产出直接回答
    let historicalContext = '';
    if (this.deps.knowledgeStore && msg.content.trim()) {
      try {
        const sessions = await this.deps.knowledgeStore.retrieve(msg.content.trim(), {
          maxSessions: 3,
          knowledgeThreshold: 0.25,
          maxCharsPerType: 1200,
        });
        historicalContext = this.deps.knowledgeStore.buildContext(sessions);
        if (historicalContext) {
          logger.info('outer-brain', {
            event: 'knowledge.retrieve',
            data: { sessions: sessions.length, preview: historicalContext.slice(0, 100) },
          });
        }
      } catch (e) {
        logger.warn('outer-brain', {
          event: 'knowledge.retrieve_error',
          data: { error: String(e) },
        });
      }
    }

    // 构建系统提示
    const systemPrompt = buildSystemPrompt(soul, msg, threadStore, this.deps, innerStatus);

    // 构建消息历史（含检索到的历史知识）
    const messages = buildMessages(msg, threadStore, this.deps, soul, historicalContext);

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

          // 引用回复：若用户消息是「回复某条消息」且工具未显式传 reply_to_msg_id，自动带入
          const toolArgs =
            tc.name === 'reply_to_user' && msg.reply_to && tc.args['reply_to_msg_id'] == null
              ? { ...tc.args, reply_to_msg_id: msg.reply_to }
              : tc.args;

          if (tool) {
            const res = await tool.call(toolArgs);
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
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/7dcedc1b-42e2-492d-870e-6453b83a8083',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'conversation-loop.ts:after_finalReply',message:'result.content vs finalReply',data:{result_content_len:result.content?.length??0,finalReply_len:finalReply?.length??0,thread_id:msg.thread_id},timestamp:Date.now(),hypothesisId:'H_LLM'})}).catch(()=>{});
      // #endregion
      break;
    }

    if (finalReply) {
      logger.info('outer-brain', {
        event: 'loop.send',
        data: { thread: msg.thread_id, content_len: finalReply.length, preview: finalReply.slice(0, 80) },
      });
      // 发送回复到对应频道（若用户消息是引用回复，则带上 reply_to 以在飞书显示为引用）
      try {
        // #region agent log
        fetch('http://127.0.0.1:7246/ingest/7dcedc1b-42e2-492d-870e-6453b83a8083',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'conversation-loop.ts:send_before',message:'finalReply before channelRegistry.send',data:{content_len:finalReply.length,log_tail_30:finalReply.slice(-30),thread_id:msg.thread_id},timestamp:Date.now(),hypothesisId:'H1_H5'})}).catch(()=>{});
        // #endregion
        await channelRegistry.send({
          thread_id: msg.thread_id,
          content:   finalReply,
          reply_to:  msg.reply_to,
        });
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
  deps: ConversationLoopDeps,
  innerStatus?: import('../channels/types.js').InnerBrainStatus | null,
): string {
  const isGroup = msg.thread_id.includes(':group:');
  const statusDesc = isGroup ? '群聊对话' : '私信对话';

  // 展示名：仅使用渠道侧名字（如飞书应用名），不写死身份名
  const agentDisplayName = deps.getAgentDisplayName?.() ?? '';
  const senderDisplayName = msg.sender_name ?? msg.user_id;

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

  const identityHint = agentDisplayName
    ? `【身份说明】你在本对话中的展示名是「${agentDisplayName}」——当用户提到该名字时，指的是你。当前这条消息的发送者展示名是「${senderDisplayName}」——当用户说「我」或「自己」时，指的是该发送者。请根据用户措辞区分他们是在说你、说自己、还是说其他人。`
    : `【身份说明】你的展示名由当前接入渠道提供（如飞书应用名）；当用户提到该名字时指的是你。当前这条消息的发送者展示名是「${senderDisplayName}」——当用户说「我」或「自己」时，指的是该发送者。请根据用户措辞区分他们是在说你、说自己、还是说其他人。`;

  const groupReplyRule = isGroup
    ? `\n【群聊回复】当前是群聊，请尽量用简短内容回复（一两句、口语化即可），避免长段落和 1.2.3. 列表，像真人接话。需要展开时再展开。\n`
    : '';

  const openingLine = agentDisplayName
    ? `你是 ${agentDisplayName}，${soul.persona}。`
    : `你是${soul.persona}。你的展示名由当前渠道（如飞书应用名）提供。`;

  return `${openingLine}
当前场景：${statusDesc}（thread: ${msg.thread_id}）
语言：${soul.language}${groupReplyRule}
${threadList}

${identityHint}

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
  historicalContext?: string,
): Message[] {
  const messages: Message[] = [];
  const isGroup = msg.thread_id.includes(':group:');

  // 全局知识库检索结果（过往任务产出的 constraints/skills/knowledge），优先注入便于直接回答
  if (historicalContext && historicalContext.trim()) {
    messages.push({
      role: 'user',
      content: `[系统：历史知识]\n${historicalContext.trim()}`,
    });
    messages.push({
      role: 'assistant',
      content: '已了解历史知识；若用户问题可由上述内容回答，请直接回复，无需再派发新任务。',
    });
  }

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
        const who = h.role === 'user'
          ? getDisplayNameForHistory(deps.userStore, group.thread_id, h.user_id ?? undefined)
          : (deps.getAgentDisplayName?.() ?? '本人');
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
      const who = getDisplayNameForHistory(deps.userStore, msg.thread_id, entry.user_id ?? undefined);
      messages.push({ role: 'user', content: `[${who}] ${entry.content}` });
    } else {
      messages.push({ role: 'assistant', content: entry.content });
    }
  }

  // 当前消息（支持多模态：图片附件转为 image_url content block）；有 sender_name 时用展示名便于区分谁在说话；有引用时带上被引用内容
  const mention   = msg.is_mention ? '（@了你）' : '';
  const speaker   = msg.sender_name ?? msg.user_id;
  let baseText    = `[${speaker}${mention}] ${msg.content}`;
  const imageAtts = (msg.attachments ?? []).filter(
    (a) => a.type === 'image' && a.url && (a.url.startsWith('data:') || a.url.startsWith('http')),
  );
  const imageUnresolved = (msg.attachments ?? []).filter(
    (a) => a.type === 'image' && (!a.url || (!a.url.startsWith('data:') && !a.url.startsWith('http'))),
  );
  if (imageUnresolved.length > 0) {
    baseText += `\n（本条含 ${imageUnresolved.length} 张图片，当前未能加载为可识别格式，请根据文字理解或提示用户重发）`;
  }
  const textPart = msg.quoted_content
    ? `[回复自: ${msg.quoted_content}]\n\n${baseText}`
    : baseText;

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
