/**
 * Discord Channel Adapter
 *
 * Implements the ChannelAdapter interface for Discord.
 * Consolidates all Discord-specific code in one place.
 */

import {
  Client,
  GatewayIntentBits,
  TextChannel,
  ChannelType,
  AttachmentBuilder,
  Message,
} from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';
import { getEnv } from '../../../config/environment.js';
import { logger } from '../../../shared/logger.js';
import { getDiscordConfig } from '../../../shared/types.js';
import {
  shouldRespondToMessage,
  type ChannelAdapter,
  type ChannelAdapterConfig,
  type ChannelMessage,
  type ChannelMessageEvent,
  type ChannelEventHandler,
  type SendMessageOptions,
  type SendFileOptions,
  type ReadMessagesOptions,
  type AddReactionOptions,
  type SendMessageResult,
  type MessageSeenHandler,
} from '../types.js';

export class DiscordChannelAdapter implements ChannelAdapter {
  readonly type = 'discord';

  private client: Client | null = null;
  private clientPromise: Promise<Client> | null = null;
  private config: ChannelAdapterConfig;
  private eventHandlers: Set<ChannelEventHandler> = new Set();
  private messageSeenHandlers: Set<MessageSeenHandler> = new Set();
  private messageListener: ((message: Message) => void) | null = null;

  constructor(config: ChannelAdapterConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.client && this.client.isReady()) {
      return;
    }

    // Prevent multiple simultaneous connection attempts
    if (this.clientPromise) {
      await this.clientPromise;
      return;
    }

    const env = getEnv();

    if (!env.DISCORD_TOKEN) {
      throw new Error(
        "DISCORD_TOKEN is required. Set it in the agent's .env file (e.g., src/agents/dev/.env)"
      );
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
    });

    this.clientPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.clientPromise = null;
        reject(new Error('Discord client failed to become ready within 30 seconds'));
      }, 30000);

      this.client!.once('ready', () => {
        clearTimeout(timeout);
        logger.info('Discord client connected', {
          botUser: this.client!.user?.tag,
        });
        this.setupMessageListener();
        resolve(this.client!);
      });

      this.client!.once('error', (error) => {
        clearTimeout(timeout);
        this.clientPromise = null;
        reject(error);
      });

      this.client!.login(env.DISCORD_TOKEN).catch((err) => {
        clearTimeout(timeout);
        this.clientPromise = null;
        reject(err);
      });
    });

    await this.clientPromise;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      if (this.messageListener) {
        this.client.off('messageCreate', this.messageListener);
        this.messageListener = null;
      }
      this.client.destroy();
      this.client = null;
      this.clientPromise = null;
      logger.info('Discord client disconnected');
    }
  }

  isConnected(): boolean {
    return this.client?.isReady() ?? false;
  }

  async sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
    const channel = await this.getTextChannel(options.channel);
    if (!channel) {
      return { success: false, error: `Channel "${options.channel}" not found` };
    }

    try {
      // Convert @rolename to <@&ROLE_ID> for proper Discord mentions
      // Skip mentions inside code blocks, inline code, or blockquotes
      const guild = channel.guild;
      const processedContent = options.content.replace(
        /(```[\s\S]*?```|`[^`]+`|^>.*$)|@(\w+)/gm,
        (match, protectedRegion, roleName) => {
          // If it's a protected region, return unchanged
          if (protectedRegion) return match;
          // Otherwise, try to convert the mention
          const role = guild.roles.cache.find(
            (r) => r.name.toLowerCase() === roleName.toLowerCase()
          );
          return role ? `<@&${role.id}>` : match;
        }
      );

      const messageOptions: { content: string; reply?: { messageReference: string } } = {
        content: processedContent,
      };

      if (options.replyTo) {
        messageOptions.reply = { messageReference: options.replyTo };
      }

      const sentMessage = await channel.send(messageOptions);

      logger.info('Message posted to Discord', {
        channel: channel.name,
        messageId: sentMessage.id,
      });

      return { success: true, messageId: sentMessage.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to send Discord message', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  async sendFile(options: SendFileOptions): Promise<SendMessageResult> {
    const channel = await this.getTextChannel(options.channel);
    if (!channel) {
      return { success: false, error: `Channel "${options.channel}" not found` };
    }

    // Check if file exists
    if (!fs.existsSync(options.filePath)) {
      return { success: false, error: `File not found: ${options.filePath}` };
    }

    // Check file size
    const stats = fs.statSync(options.filePath);
    const maxSize = 8 * 1024 * 1024; // 8MB Discord limit

    if (stats.size > maxSize) {
      return {
        success: false,
        error: `File size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds Discord's 8MB limit`,
      };
    }

    try {
      const fileName = path.basename(options.filePath);
      const attachment = new AttachmentBuilder(options.filePath, { name: fileName });

      const sentMessage = await channel.send({
        content: options.content || '',
        files: [attachment],
      });

      logger.info('File sent to Discord', {
        channel: channel.name,
        messageId: sentMessage.id,
        fileName,
        fileSize: stats.size,
      });

      return { success: true, messageId: sentMessage.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to send file to Discord', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  async readMessages(options: ReadMessagesOptions): Promise<ChannelMessage[]> {
    const channel = await this.getTextChannel(options.channel);
    if (!channel) {
      return [];
    }

    try {
      const fetchOptions: { limit: number; after?: string } = {
        limit: options.limit ?? 50,
      };
      if (options.after) {
        fetchOptions.after = options.after;
      }

      const messages = await channel.messages.fetch(fetchOptions);
      const sortedMessages = [...messages.values()].reverse();

      return sortedMessages.map((msg) => this.convertMessage(msg, channel.name));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to read Discord messages', { error: errorMessage });
      return [];
    }
  }

  /**
   * Fetch a single message by ID
   * Returns null if message not found
   */
  async fetchMessage(channelNameOrId: string, messageId: string): Promise<ChannelMessage | null> {
    const channel = await this.getTextChannel(channelNameOrId);
    if (!channel) {
      return null;
    }

    try {
      const message = await channel.messages.fetch(messageId);
      return this.convertMessage(message, channel.name);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.debug('Failed to fetch Discord message', { error: errorMessage, messageId });
      return null;
    }
  }

  async addReaction(options: AddReactionOptions): Promise<SendMessageResult> {
    const channel = await this.getTextChannel(options.channel);
    if (!channel) {
      return { success: false, error: `Channel "${options.channel}" not found` };
    }

    try {
      const message = await channel.messages.fetch(options.messageId);
      await message.react(options.emoji);

      logger.info('Reaction added to Discord message', {
        channel: channel.name,
        messageId: options.messageId,
        emoji: options.emoji,
      });

      return { success: true, messageId: options.messageId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add reaction', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  onMessage(handler: ChannelEventHandler): void {
    this.eventHandlers.add(handler);
  }

  offMessage(handler: ChannelEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  onMessageSeen(handler: MessageSeenHandler): void {
    this.messageSeenHandlers.add(handler);
  }

  offMessageSeen(handler: MessageSeenHandler): void {
    this.messageSeenHandlers.delete(handler);
  }

  /**
   * Get the underlying Discord client (for advanced operations)
   * This is an escape hatch for Discord-specific features not in the interface
   */
  getClient(): Client | null {
    return this.client;
  }

  /**
   * Get a guild by ID
   */
  getGuild() {
    const env = getEnv();
    return this.client?.guilds.cache.get(env.DISCORD_GUILD_ID);
  }

  // Private helper methods

  private async getTextChannel(channelNameOrId: string): Promise<TextChannel | null> {
    if (!this.client?.isReady()) {
      await this.connect();
    }

    const guild = this.getGuild();
    if (!guild) {
      logger.error('Guild not found');
      return null;
    }

    const channel = guild.channels.cache.find(
      (c) =>
        (c.name === channelNameOrId || c.id === channelNameOrId) && c.type === ChannelType.GuildText
    ) as TextChannel | undefined;

    return channel ?? null;
  }

  private convertMessage(msg: Message, channelName: string): ChannelMessage {
    return {
      id: msg.id,
      channelId: msg.channel.id,
      channelName,
      author: {
        id: msg.author.id,
        name: msg.author.tag,
        isBot: msg.author.bot,
      },
      content: msg.content,
      timestamp: msg.createdAt,
      attachments: msg.attachments.map((att) => ({
        id: att.id,
        filename: att.name ?? 'unknown',
        url: att.url,
        contentType: att.contentType ?? undefined,
        size: att.size,
      })),
      replyTo: msg.reference?.messageId,
      mentionedRoles: msg.mentions.roles.map((r) => r.name),
      mentionedUserIds: msg.mentions.users.map((u) => u.id),
    };
  }

  private setupMessageListener(): void {
    if (!this.client || this.messageListener) return;

    const env = getEnv();
    const { agentConfig, otherAgentRoles } = this.config;
    const discordConfig = getDiscordConfig(agentConfig);
    const botUserId = this.client.user?.id;

    this.messageListener = async (message: Message) => {
      try {
        // Check if message is from our guild
        if (message.guild?.id !== env.DISCORD_GUILD_ID) {
          return;
        }

        // Get channel name
        const channel = message.channel as TextChannel;
        const channelName = channel.name;

        // Check if this channel is in our readable channels
        if (!discordConfig.canRead.includes(channelName)) {
          return;
        }

        // Emit "message seen" event for ALL messages in readable channels
        // This is used for tracking lastProcessedMessageId regardless of response
        for (const handler of this.messageSeenHandlers) {
          try {
            await handler({ channelName, messageId: message.id });
          } catch (error) {
            const err = error instanceof Error ? error.message : String(error);
            logger.error('Error in message seen handler', { error: err });
          }
        }

        // Convert to normalized message format
        const normalizedMessage = this.convertMessage(message, channelName);

        // Check if this message is a reply to one of this agent's messages
        let isReplyToAgent = false;
        if (message.reference?.messageId && botUserId) {
          try {
            const referencedMessage = await channel.messages.fetch(message.reference.messageId);
            isReplyToAgent = referencedMessage.author.id === botUserId;
          } catch {
            logger.debug('Could not fetch referenced message', {
              messageId: message.reference.messageId,
            });
          }
        }

        // Use shared logic to determine if we should respond
        const { shouldRespond, isMention, otherAgentMentioned } = shouldRespondToMessage({
          message: normalizedMessage,
          myRole: discordConfig.role,
          botUserId,
          otherAgentRoles,
          primaryChannel: discordConfig.primary,
          onChannelMessage: discordConfig.triggers.onChannelMessage,
          isReplyToAgent,
        });

        // Debug logging
        logger.debug('Message received', {
          channel: channelName,
          author: message.author.tag,
          content: message.content.substring(0, 100),
          isMention,
          otherAgentMentioned,
          isReplyToAgent,
          shouldRespond,
        });

        if (shouldRespond) {
          const event: ChannelMessageEvent = {
            type: isMention ? 'mention' : 'message',
            message: normalizedMessage,
            isMention,
            otherAgentMentioned,
            isReplyToAgent,
          };

          // Emit to all handlers
          for (const handler of this.eventHandlers) {
            try {
              await handler(event);
            } catch (error) {
              const err = error instanceof Error ? error.message : String(error);
              logger.error('Error in message event handler', { error: err });
            }
          }
        }
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error);
        logger.error('Error handling Discord message', { error: err });
      }
    };

    this.client.on('messageCreate', this.messageListener);
    logger.info('Discord message listener started', {
      onMention: discordConfig.triggers.onMention,
      onChannelMessage: discordConfig.triggers.onChannelMessage,
      primaryChannel: discordConfig.primary,
    });
  }
}

/**
 * Create a Discord channel adapter
 */
export function createDiscordAdapter(config: ChannelAdapterConfig): DiscordChannelAdapter {
  return new DiscordChannelAdapter(config);
}
