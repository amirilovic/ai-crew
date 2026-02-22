/**
 * Channel Adapters
 *
 * Unified interface for communication channels (Discord, Slack, etc.)
 */

// Types
export type {
  ChannelAdapter,
  ChannelAdapterConfig,
  ChannelAdapterFactory,
  ChannelMessage,
  ChannelAttachment,
  ChannelMessageEvent,
  ChannelEventHandler,
  ChannelEventType,
  SendMessageOptions,
  SendFileOptions,
  ReadMessagesOptions,
  AddReactionOptions,
  SendMessageResult,
} from './types.js';

// Discord adapter
export {
  DiscordChannelAdapter,
  createDiscordAdapter,
  createDiscordMcpTools,
} from './discord/index.js';
