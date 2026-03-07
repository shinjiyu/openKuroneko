/**
 * 频道适配器注册表
 *
 * 外脑启动时注册所有 ChannelAdapter，统一管理生命周期。
 * 发消息时通过 send() 路由到正确频道。
 */

import type { ChannelAdapter, InboundMessage, OutboundMessage } from './types.js';

export class ChannelRegistry {
  private readonly adapters = new Map<string, ChannelAdapter>();
  private messageHandler: ((msg: InboundMessage) => Promise<void>) | null = null;

  register(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.channel_id)) {
      throw new Error(`Channel adapter already registered: ${adapter.channel_id}`);
    }
    this.adapters.set(adapter.channel_id, adapter);
  }

  getAdapter(channelId: string): ChannelAdapter | undefined {
    return this.adapters.get(channelId);
  }

  getAllAdapters(): ChannelAdapter[] {
    return [...this.adapters.values()];
  }

  /**
   * 启动所有已注册适配器，统一回调 onMessage。
   */
  async startAll(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void> {
    this.messageHandler = onMessage;
    for (const adapter of this.adapters.values()) {
      await adapter.start(onMessage);
    }
  }

  /**
   * 向指定 thread 发送消息。
   * thread_id 格式 <channel>:<type>:<id>，从中解析出 channel_id。
   */
  async send(msg: OutboundMessage): Promise<void> {
    const channelId = extractChannelId(msg.thread_id);
    const adapter = this.adapters.get(channelId);
    if (!adapter) {
      throw new Error(`No adapter registered for channel: ${channelId} (thread: ${msg.thread_id})`);
    }
    await adapter.send(msg);
  }

  async stopAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.stop();
    }
  }
}

/** 从 thread_id 提取 channel_id（取第一段） */
export function extractChannelId(threadId: string): string {
  return threadId.split(':')[0] ?? threadId;
}

/** 从 thread_id 提取 type（取第二段） */
export function extractThreadType(threadId: string): 'dm' | 'group' {
  return (threadId.split(':')[1] ?? 'dm') === 'group' ? 'group' : 'dm';
}

/** 从 thread_id 提取 peer_id（取第三段） */
export function extractPeerId(threadId: string): string {
  return threadId.split(':').slice(2).join(':') ?? '';
}
