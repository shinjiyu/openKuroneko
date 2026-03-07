/**
 * Thread Store — 对话线程注册与上下文管理
 *
 * 职责：
 * 1. 维护 Thread 元数据（thread_id、type、members 等）
 * 2. 存储每个 thread 的对话历史（用于 LLM context 构建）
 * 3. 群聊摘要维护
 * 4. 持久化到 <obDir>/threads/ 目录（JSON Lines 格式）
 *
 * 设计：内存 + 文件双写。重启后从文件恢复。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Thread, InboundMessage } from '../channels/types.js';

/** 对话历史条目 */
export interface HistoryEntry {
  role: 'user' | 'assistant';
  user_id?: string | undefined;    // 用户消息时的 user_id
  content: string;
  ts: number;
}

/** 线程完整记录（内存） */
export interface ThreadRecord {
  thread: Thread;
  history: HistoryEntry[];
}

export class ThreadStore {
  private readonly threadsDir: string;
  private readonly records = new Map<string, ThreadRecord>();
  /** 每个 thread 保留的最近历史条数 */
  private readonly maxHistoryPerThread: number;

  constructor(obDir: string, maxHistoryPerThread = 40) {
    this.threadsDir = path.join(obDir, 'threads');
    this.maxHistoryPerThread = maxHistoryPerThread;
    fs.mkdirSync(this.threadsDir, { recursive: true });
    this.loadFromDisk();
  }

  // ── Thread 元数据 ─────────────────────────────────────────────────────────

  getOrCreate(msg: InboundMessage): Thread {
    const existing = this.records.get(msg.thread_id);
    if (existing) {
      existing.thread.last_msg_at = msg.ts;
      return existing.thread;
    }

    const parts = msg.thread_id.split(':');
    const type  = parts[1] === 'group' ? 'group' : 'dm';
    const peerId = parts.slice(2).join(':');

    const thread: Thread = {
      thread_id:  msg.thread_id,
      channel_id: msg.channel_id,
      type,
      peer_id:    peerId,
      group_name: msg.group_info?.group_name,
      members:    msg.group_info?.known_members,
      created_at: msg.ts,
      last_msg_at: msg.ts,
    };

    this.records.set(msg.thread_id, { thread, history: [] });
    this.saveThread(thread);
    return thread;
  }

  getThread(threadId: string): Thread | undefined {
    return this.records.get(threadId)?.thread;
  }

  listThreadIds(): string[] {
    return [...this.records.keys()];
  }

  /**
   * 列出所有 thread，附带人类可读名称。
   * 格式：{ thread_id, display_name }
   * - DM：`dm:<peer_id>`
   * - Group：group_name（如"项目组"）或 peer_id
   */
  listThreadsWithNames(): Array<{ thread_id: string; display_name: string }> {
    return [...this.records.values()].map(({ thread }) => ({
      thread_id:    thread.thread_id,
      display_name: thread.type === 'group'
        ? (thread.group_name ?? thread.peer_id)
        : `私信:${thread.peer_id}`,
    }));
  }

  /**
   * 查找与指定用户共同参与的群 thread（用于 DM 上下文注入）。
   * 条件：thread.type === 'group' 且 thread.members 包含 userId，
   * 或该 thread 历史中存在该 user_id 的消息。
   */
  getSharedGroupThreads(userId: string): Thread[] {
    const result: Thread[] = [];
    for (const { thread, history } of this.records.values()) {
      if (thread.type !== 'group') continue;
      const inMembers = thread.members?.includes(userId) ?? false;
      const inHistory = history.some((h) => h.role === 'user' && h.user_id === userId);
      if (inMembers || inHistory) result.push(thread);
    }
    return result;
  }

  updateGroupSummary(threadId: string, summary: string): void {
    const rec = this.records.get(threadId);
    if (!rec) return;
    rec.thread.group_summary = summary;
    this.saveThread(rec.thread);
  }

  updateGroupMembers(threadId: string, members: string[]): void {
    const rec = this.records.get(threadId);
    if (!rec) return;
    rec.thread.members = members;
    this.saveThread(rec.thread);
  }

  allThreads(): Thread[] {
    return [...this.records.values()].map((r) => r.thread);
  }

  // ── 对话历史 ──────────────────────────────────────────────────────────────

  appendUser(threadId: string, userId: string, content: string, ts: number): void {
    const rec = this.records.get(threadId);
    if (!rec) return;
    rec.history.push({ role: 'user', user_id: userId, content, ts });
    this.trimHistory(rec);
    this.appendHistoryToDisk(threadId, { role: 'user', user_id: userId, content, ts });
  }

  appendAssistant(threadId: string, content: string, ts: number): void {
    const rec = this.records.get(threadId);
    if (!rec) return;
    rec.history.push({ role: 'assistant', content, ts });
    this.trimHistory(rec);
    this.appendHistoryToDisk(threadId, { role: 'assistant', content, ts });
  }

  getHistory(threadId: string): HistoryEntry[] {
    return this.records.get(threadId)?.history ?? [];
  }

  /**
   * 搜索线程历史（用于 search_thread 工具）
   * 简单关键词搜索，返回匹配的历史条目。
   */
  searchHistory(threadId: string, query: string, limit = 10): HistoryEntry[] {
    const history = this.records.get(threadId)?.history ?? [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return history
      .filter((h) => terms.some((t) => h.content.toLowerCase().includes(t)))
      .slice(-limit);
  }

  /**
   * 搜索某用户参与的所有私信 thread 的历史。
   * 用于将同一用户跨频道的私信合并视图。
   */
  searchUserHistory(userId: string, query: string, limit = 20): Array<HistoryEntry & { thread_id: string }> {
    const results: Array<HistoryEntry & { thread_id: string }> = [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

    for (const [threadId, rec] of this.records) {
      if (rec.thread.type !== 'dm') continue;
      if (rec.thread.peer_id !== userId && !rec.thread.thread_id.includes(userId)) continue;

      for (const entry of rec.history) {
        if (terms.some((t) => entry.content.toLowerCase().includes(t))) {
          results.push({ ...entry, thread_id: threadId });
        }
      }
    }

    results.sort((a, b) => b.ts - a.ts);
    return results.slice(0, limit);
  }

  // ── 磁盘持久化 ────────────────────────────────────────────────────────────

  private saveThread(thread: Thread): void {
    const file = this.threadMetaFile(thread.thread_id);
    fs.writeFileSync(file, JSON.stringify(thread, null, 2), 'utf8');
  }

  private appendHistoryToDisk(threadId: string, entry: HistoryEntry): void {
    const file = this.threadHistoryFile(threadId);
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.threadsDir)) return;

    for (const name of fs.readdirSync(this.threadsDir)) {
      if (!name.endsWith('.meta.json')) continue;
      try {
        const metaPath = path.join(this.threadsDir, name);
        const thread = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Thread;
        const historyPath = this.threadHistoryFile(thread.thread_id);

        const history: HistoryEntry[] = [];
        if (fs.existsSync(historyPath)) {
          const lines = fs.readFileSync(historyPath, 'utf8').split('\n').filter(Boolean);
          // 只加载最近 maxHistoryPerThread 条
          for (const line of lines.slice(-this.maxHistoryPerThread)) {
            try {
              history.push(JSON.parse(line) as HistoryEntry);
            } catch { /* skip malformed */ }
          }
        }

        this.records.set(thread.thread_id, { thread, history });
      } catch { /* skip malformed */ }
    }
  }

  private trimHistory(rec: ThreadRecord): void {
    if (rec.history.length > this.maxHistoryPerThread) {
      rec.history.splice(0, rec.history.length - this.maxHistoryPerThread);
    }
  }

  private threadMetaFile(threadId: string): string {
    const safe = threadId.replace(/[:/]/g, '_');
    return path.join(this.threadsDir, `${safe}.meta.json`);
  }

  private threadHistoryFile(threadId: string): string {
    const safe = threadId.replace(/[:/]/g, '_');
    return path.join(this.threadsDir, `${safe}.history.jsonl`);
  }
}
