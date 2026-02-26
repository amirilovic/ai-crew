/**
 * Channel Adapter Interface
 *
 * Defines the contract for communication channel adapters (Discord, Slack, etc.)
 * This allows agents to work with different platforms through a unified interface.
 */

import type { AgentConfig } from '../../shared/types.js';

/**
 * Represents a message from a channel
 */
export interface ChannelMessage {
  id: string;
  channelId: string;
  channelName: string;
  author: {
    id: string;
    name: string;
    isBot: boolean;
  };
  content: string;
  timestamp: Date;
  attachments: ChannelAttachment[];
  /** The message this is replying to, if any */
  replyTo?: string;
  /** Role mentions in the message (e.g., ['dev', 'po']) */
  mentionedRoles: string[];
  /** User ID mentions in the message */
  mentionedUserIds: string[];
}

/**
 * Context needed to determine if we should respond to a message
 */
export interface ShouldRespondContext {
  message: ChannelMessage;
  myRole: string;
  botUserId?: string;
  otherAgentRoles: string[];
  primaryChannel: string;
  onChannelMessage: boolean;
  isReplyToAgent: boolean;
}

/**
 * Result of shouldRespondToMessage check
 */
export interface ShouldRespondResult {
  shouldRespond: boolean;
  isMention: boolean;
  otherAgentMentioned: boolean;
}

/**
 * Determine if we should respond to a message.
 * Shared logic used by both live message handling and catch-up.
 */
export function shouldRespondToMessage(ctx: ShouldRespondContext): ShouldRespondResult {
  const {
    message,
    myRole,
    botUserId,
    otherAgentRoles,
    primaryChannel,
    onChannelMessage,
    isReplyToAgent,
  } = ctx;

  // Check if this agent's role is mentioned
  const myRoleMentioned = message.mentionedRoles.includes(myRole);

  // Check if this agent's user ID is mentioned (e.g., @BotName)
  const myUserMentioned = botUserId ? message.mentionedUserIds.includes(botUserId) : false;

  // Combined mention check
  const isMention = myRoleMentioned || myUserMentioned;

  // Check if another agent's role is mentioned
  const otherAgentMentioned = message.mentionedRoles.some((role) => otherAgentRoles.includes(role));

  const isPrimaryChannel = message.channelName === primaryChannel;

  // Bot messages: only respond if this agent is explicitly mentioned
  // Human messages: respond to mentions, replies, or primary channel (unless another agent mentioned)
  const shouldRespond = message.author.isBot
    ? isMention
    : isMention || isReplyToAgent || (isPrimaryChannel && onChannelMessage && !otherAgentMentioned);

  return { shouldRespond, isMention, otherAgentMentioned };
}

/**
 * Represents a file attachment
 */
export interface ChannelAttachment {
  id: string;
  filename: string;
  url: string;
  contentType?: string;
  size: number;
}

/**
 * Options for sending a message
 */
export interface SendMessageOptions {
  /** Channel name or ID to send to */
  channel: string;
  /** Message content */
  content: string;
  /** Message ID to reply to */
  replyTo?: string;
}

/**
 * Options for sending a file
 */
export interface SendFileOptions {
  /** Channel name or ID to send to */
  channel: string;
  /** Path to the file to send */
  filePath: string;
  /** Optional message content */
  content?: string;
}

/**
 * Options for reading messages
 */
export interface ReadMessagesOptions {
  /** Channel name or ID to read from */
  channel: string;
  /** Maximum number of messages to fetch */
  limit?: number;
  /** Fetch messages after this message ID */
  after?: string;
}

/**
 * Options for adding a reaction
 */
export interface AddReactionOptions {
  /** Channel name or ID */
  channel: string;
  /** Message ID to react to */
  messageId: string;
  /** Emoji to add (unicode or custom emoji name) */
  emoji: string;
}

/**
 * Result of sending a message
 */
export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Event types that can be emitted by a channel adapter
 */
export type ChannelEventType = 'message' | 'mention' | 'reaction';

/**
 * Event emitted when a message is received
 */
export interface ChannelMessageEvent {
  type: 'message' | 'mention';
  message: ChannelMessage;
  /** Whether this agent's role was mentioned */
  isMention: boolean;
  /** Whether another agent's role was mentioned */
  otherAgentMentioned: boolean;
  /** Whether this message is a reply to a message from this agent */
  isReplyToAgent: boolean;
}

/**
 * Handler for channel events
 */
export type ChannelEventHandler = (event: ChannelMessageEvent) => Promise<void>;

/**
 * Event emitted for every message seen in readable channels
 * Used for tracking lastProcessedMessageId regardless of whether we respond
 */
export interface MessageSeenEvent {
  channelName: string;
  messageId: string;
}

/**
 * Handler for message seen events (for tracking purposes)
 */
export type MessageSeenHandler = (event: MessageSeenEvent) => Promise<void>;

/**
 * Channel Adapter Interface
 *
 * Implement this interface to add support for a new communication platform.
 */
export interface ChannelAdapter {
  /** Unique identifier for this adapter type (e.g., 'discord', 'slack') */
  readonly type: string;

  /**
   * Initialize and connect to the channel
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the channel
   */
  disconnect(): Promise<void>;

  /**
   * Check if the adapter is connected
   */
  isConnected(): boolean;

  /**
   * Send a text message to a channel
   */
  sendMessage(options: SendMessageOptions): Promise<SendMessageResult>;

  /**
   * Send a file to a channel
   */
  sendFile(options: SendFileOptions): Promise<SendMessageResult>;

  /**
   * Read messages from a channel
   */
  readMessages(options: ReadMessagesOptions): Promise<ChannelMessage[]>;

  /**
   * Add a reaction to a message
   */
  addReaction(options: AddReactionOptions): Promise<SendMessageResult>;

  /**
   * Subscribe to channel events (filtered - only events that should trigger responses)
   */
  onMessage(handler: ChannelEventHandler): void;

  /**
   * Unsubscribe from channel events
   */
  offMessage(handler: ChannelEventHandler): void;

  /**
   * Subscribe to all messages seen in readable channels (for tracking purposes)
   * This fires for EVERY message, not just ones that trigger responses
   */
  onMessageSeen?(handler: MessageSeenHandler): void;

  /**
   * Unsubscribe from message seen events
   */
  offMessageSeen?(handler: MessageSeenHandler): void;
}

/**
 * Configuration for creating a channel adapter
 */
export interface ChannelAdapterConfig {
  /** Agent configuration */
  agentConfig: AgentConfig;
  /** List of other agent roles (for detecting agent-to-agent mentions) */
  otherAgentRoles: string[];
}

/**
 * Factory function type for creating channel adapters
 */
export type ChannelAdapterFactory = (config: ChannelAdapterConfig) => ChannelAdapter;
