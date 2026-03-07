export type {
  InboundMessage,
  OutboundMessage,
  MessageAttachment,
  GroupInfo,
  ChannelAdapter,
  Thread,
  ThreadType,
  UserChannelBinding,
  UserRole,
  User,
  InnerBrainStatus,
  InnerBrainOutput,
} from './types.js';

export { ChannelRegistry, extractChannelId, extractThreadType, extractPeerId } from './registry.js';
export { CliChannelAdapter } from './adapters/cli.js';
export { FeishuChannelAdapter } from './adapters/feishu.js';
export { WebchatChannelAdapter } from './adapters/webchat.js';
