import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';
import type { AgentConfig, TriggerEvent } from '../types.js';
import { getDiscordConfig, getDiscordConfigOrNull } from '../types.js';
import { getOtherAgentRoles } from '../agent-discovery.js';
import type { DiscordChannelAdapter } from '../../core/channels/discord/adapter.js';
import type { ChannelMessageEvent } from '../../core/channels/types.js';
import { EventRouter, type EventRouterCallbacks } from '../../core/runtime/event-router.js';
import { CronScheduler, type CronJobConfig } from '../../core/runtime/cron-scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

type TriggerHandler = (event: TriggerEvent) => Promise<void>;

interface AgentState {
  /** Per-channel tracking of last processed message IDs */
  lastProcessedMessageIds?: Record<string, string>;
  /** @deprecated Legacy global tracking - migrated to lastProcessedMessageIds */
  lastProcessedMessageId?: string;
  sessionId?: string;
}

async function loadState(agentName: string): Promise<AgentState> {
  const statePath = join(__dirname, '..', '..', '..', 'data', `${agentName}-state.json`);
  try {
    const content = await readFile(statePath, 'utf-8');
    const state = JSON.parse(content);

    // Migrate from legacy global lastProcessedMessageId to per-channel tracking
    let lastProcessedMessageIds = state.lastProcessedMessageIds;
    if (!lastProcessedMessageIds && state.lastProcessedMessageId) {
      // Legacy format - we'll initialize per-channel tracking on first message
      // Keep the legacy value for logging but don't use it
      logger.info('Migrating from legacy global lastProcessedMessageId', {
        agentName,
        legacyId: state.lastProcessedMessageId,
      });
      lastProcessedMessageIds = {};
    }

    logger.info('Loaded state from file', {
      agentName,
      lastProcessedMessageIds,
      sessionId: state.sessionId,
    });
    return {
      lastProcessedMessageIds,
      sessionId: state.sessionId,
    };
  } catch {
    logger.info('No existing state file, starting fresh', { agentName });
    return {};
  }
}

export { loadState, saveState };

async function saveState(agentName: string, state: AgentState): Promise<void> {
  const dataDir = join(__dirname, '..', '..', '..', 'data');
  const statePath = join(dataDir, `${agentName}-state.json`);
  try {
    await mkdir(dataDir, { recursive: true });
    // Only save new format (lastProcessedMessageIds), drop legacy lastProcessedMessageId
    const stateToSave = {
      lastProcessedMessageIds: state.lastProcessedMessageIds,
      sessionId: state.sessionId,
    };
    await writeFile(statePath, JSON.stringify(stateToSave, null, 2));
  } catch (error) {
    logger.error('Failed to save state', { error });
  }
}

export class TriggerManager {
  private config: AgentConfig;
  private pollingIntervals: NodeJS.Timeout[] = [];
  private state: AgentState = {};
  private isRunning = false;
  private messageHandler: ((event: ChannelMessageEvent) => Promise<void>) | null = null;
  private discordAdapter?: DiscordChannelAdapter;
  private eventRouter: EventRouter<TriggerEvent>;
  private cronScheduler: CronScheduler<TriggerEvent>;

  constructor(
    config: AgentConfig,
    onTrigger: TriggerHandler,
    discordAdapter?: DiscordChannelAdapter
  ) {
    this.config = config;
    this.discordAdapter = discordAdapter;

    // Create event router with callbacks for state updates
    const callbacks: EventRouterCallbacks<TriggerEvent> = {
      onEnqueue: async (event) => {
        // Add "waiting" reaction for Discord messages
        if (this.discordAdapter && event.payload.channelName && event.payload.messageId) {
          try {
            await this.discordAdapter.addReaction({
              channel: event.payload.channelName as string,
              messageId: event.payload.messageId as string,
              emoji: '⏳',
            });
          } catch {
            // Ignore reaction errors
          }
        }
      },
      onProcessed: async (event) => {
        // Update lastProcessedMessageIds for Discord messages (per-channel tracking)
        if (
          (event.type === 'discord_mention' || event.type === 'discord_message') &&
          event.payload.messageId &&
          event.payload.channelName
        ) {
          const messageId = event.payload.messageId as string;
          const channelName = event.payload.channelName as string;

          // Initialize per-channel tracking if needed
          if (!this.state.lastProcessedMessageIds) {
            this.state.lastProcessedMessageIds = {};
          }

          const currentId = this.state.lastProcessedMessageIds[channelName];
          if (!currentId || messageId > currentId) {
            this.state.lastProcessedMessageIds[channelName] = messageId;
            await saveState(this.config.name, this.state);
          }
        }
      },
    };

    this.eventRouter = new EventRouter<TriggerEvent>(onTrigger, callbacks, {
      name: `TriggerManager(${config.name})`,
      maxQueueSize: 100,
    });

    // Convert agent cron config to CronJobConfig format
    const cronConfigs: CronJobConfig[] = config.cron.map((cronConfig) => ({
      schedule: cronConfig.schedule,
      task: cronConfig.task,
      fireOnStart: true, // Fire immediately on startup (existing behavior)
    }));

    // Event factory to create TriggerEvent from cron config
    const cronEventFactory = (cronConfig: CronJobConfig, immediate: boolean): TriggerEvent => ({
      type: 'cron',
      source: cronConfig.task,
      payload: {
        schedule: cronConfig.schedule,
        ...(immediate ? { immediate: true } : {}),
      },
      timestamp: new Date(),
    });

    this.cronScheduler = new CronScheduler<TriggerEvent>(
      this.eventRouter,
      cronConfigs,
      { name: `CronScheduler(${config.name})` },
      cronEventFactory
    );
  }

  /**
   * Enqueue an event for processing
   */
  private async enqueue(event: TriggerEvent): Promise<void> {
    await this.eventRouter.enqueue(event);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('TriggerManager already running');
      return;
    }

    // Load persisted state
    this.state = await loadState(this.config.name);

    this.isRunning = true;
    logger.info('Starting TriggerManager', { agent: this.config.name });

    // Start cron scheduler (handles all cron job setup and fire-on-start)
    await this.cronScheduler.start();

    // Set up Discord event listener if Discord is configured
    const discordConfig = getDiscordConfigOrNull(this.config);
    if (
      discordConfig &&
      (discordConfig.triggers.onMention || discordConfig.triggers.onChannelMessage)
    ) {
      await this.setupDiscordEvents();
      // Catch up on any messages missed while offline
      await this.catchUpMissedMessages();
    }
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping TriggerManager');

    // Stop cron scheduler
    this.cronScheduler.stop();

    for (const interval of this.pollingIntervals) {
      clearInterval(interval);
    }
    this.pollingIntervals = [];

    // Remove Discord event listener using the adapter
    if (this.messageHandler && this.discordAdapter) {
      this.discordAdapter.offMessage(this.messageHandler);
      this.messageHandler = null;
    }

    this.isRunning = false;
  }

  private async catchUpMissedMessages(): Promise<void> {
    if (!this.discordAdapter) {
      logger.warn('No Discord adapter provided, skipping catch-up');
      return;
    }

    const discordConfig = getDiscordConfigOrNull(this.config);
    if (!discordConfig) {
      logger.warn('No Discord config, skipping catch-up');
      return;
    }

    try {
      // Use dynamically discovered agent roles
      const otherAgentRoles = getOtherAgentRoles(discordConfig.role);

      // Initialize per-channel tracking if needed
      if (!this.state.lastProcessedMessageIds) {
        this.state.lastProcessedMessageIds = {};
      }

      // Check channels the agent can read
      for (const channelName of discordConfig.canRead) {
        const lastProcessedId = this.state.lastProcessedMessageIds[channelName];

        // If no lastProcessedMessageId for this channel, initialize from latest and skip catch-up
        if (!lastProcessedId) {
          const latestMessages = await this.discordAdapter.readMessages({
            channel: channelName,
            limit: 1,
          });
          if (latestMessages.length > 0) {
            this.state.lastProcessedMessageIds[channelName] =
              latestMessages[latestMessages.length - 1].id;
            await saveState(this.config.name, this.state);
            logger.info('Initialized lastProcessedMessageId for channel, skipping catch-up', {
              channel: channelName,
              messageId: this.state.lastProcessedMessageIds[channelName],
            });
          }
          continue;
        }

        // Fetch messages after lastProcessedMessageId for this channel
        const messages = await this.discordAdapter.readMessages({
          channel: channelName,
          limit: 50,
          after: lastProcessedId,
        });

        if (messages.length === 0) {
          continue;
        }

        logger.info('Catching up on missed messages', {
          channel: channelName,
          count: messages.length,
          afterMessageId: lastProcessedId,
        });

        // Get bot user ID for reply detection
        const botUserId = this.discordAdapter.getClient()?.user?.id;

        // Messages are already in chronological order from the adapter
        for (const message of messages) {
          // Check if this agent's role is mentioned
          const myRoleMentioned = message.mentionedRoles?.includes(discordConfig.role) ?? false;

          // Check if another agent's role is mentioned
          const otherAgentMentioned =
            message.mentionedRoles?.some((role) => otherAgentRoles.includes(role)) ?? false;

          // Check if this message is a reply to one of this agent's messages
          let isReplyToAgent = false;
          if (message.replyTo && botUserId) {
            try {
              // Fetch the referenced message to check if it's from us
              const referencedMessage = await this.discordAdapter.fetchMessage(
                channelName,
                message.replyTo
              );
              if (referencedMessage) {
                isReplyToAgent = referencedMessage.author.id === botUserId;
              }
            } catch {
              // Ignore fetch errors - reply detection will fail gracefully
              logger.debug('Could not fetch referenced message for catch-up', {
                messageId: message.replyTo,
              });
            }
          }

          // Determine if we should respond
          // For bot messages: ONLY respond if explicitly mentioned (enables agent-to-agent communication)
          // For human messages: respond to mentions, replies to agent, OR primary channel (unless another agent is mentioned)
          const isPrimaryChannel = channelName === discordConfig.primary;
          let shouldRespond = false;

          if (message.author.isBot) {
            // Bot messages: only respond if this agent is explicitly mentioned
            shouldRespond = myRoleMentioned;
          } else {
            // Human messages: respond to mentions, replies, OR primary channel (unless another agent is mentioned)
            shouldRespond =
              myRoleMentioned ||
              isReplyToAgent ||
              (isPrimaryChannel && discordConfig.triggers.onChannelMessage && !otherAgentMentioned);
          }

          if (shouldRespond) {
            const triggerType = myRoleMentioned ? 'discord_mention' : 'discord_message';
            logger.info(`Catch-up: ${triggerType} detected`, {
              channel: channelName,
              messageId: message.id,
              author: message.author.name,
              isReplyToAgent,
            });

            await this.enqueue({
              type: triggerType,
              source: channelName,
              payload: {
                messageId: message.id,
                channelId: message.channelId,
                channelName: message.channelName,
                author: message.author.name,
                authorId: message.author.id,
                content: message.content,
                isReplyToAgent,
              },
              timestamp: message.timestamp,
            });
          }
        }
      }
    } catch (error) {
      const err = error instanceof Error ? { message: error.message, stack: error.stack } : error;
      logger.error('Error catching up on missed messages', { error: err });
    }
  }

  private async setupDiscordEvents(): Promise<void> {
    if (!this.discordAdapter) {
      logger.warn('No Discord adapter provided, skipping Discord event setup');
      return;
    }

    // The adapter handles all the filtering logic (mentions, channels, etc.)
    // We just need to convert the ChannelMessageEvent to a TriggerEvent
    this.messageHandler = async (event: ChannelMessageEvent) => {
      try {
        const { message, isMention } = event;
        const triggerType = isMention ? 'discord_mention' : 'discord_message';

        logger.info(`Discord ${triggerType} detected via adapter`, {
          channel: message.channelName,
          messageId: message.id,
          author: message.author.name,
          queueLength: this.eventRouter.queueLength,
        });

        await this.enqueue({
          type: triggerType,
          source: message.channelName,
          payload: {
            messageId: message.id,
            channelId: message.channelId,
            channelName: message.channelName,
            author: message.author.name,
            authorId: message.author.id,
            content: message.content,
          },
          timestamp: message.timestamp,
        });
      } catch (error) {
        const err = error instanceof Error ? { message: error.message, stack: error.stack } : error;
        logger.error('Error handling Discord message from adapter', { error: err });
      }
    };

    this.discordAdapter.onMessage(this.messageHandler);
    const discordConfig = getDiscordConfig(this.config);
    logger.info('Discord event listener started via adapter', {
      onMention: discordConfig.triggers.onMention,
      onChannelMessage: discordConfig.triggers.onChannelMessage,
      primaryChannel: discordConfig.primary,
    });
  }
}
