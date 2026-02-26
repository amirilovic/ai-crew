import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';
import type { AgentConfig, TriggerEvent, ScheduledTaskConfig } from '../types.js';
import { getDiscordConfig, getDiscordConfigOrNull } from '../types.js';
import { getOtherAgentRoles } from '../agent-discovery.js';
import type { DiscordChannelAdapter } from '../../core/channels/discord/adapter.js';
import {
  shouldRespondToMessage,
  type ChannelMessage,
  type ChannelMessageEvent,
  type MessageSeenEvent,
} from '../../core/channels/types.js';
import { EventRouter, type EventRouterCallbacks } from '../../core/runtime/event-router.js';
import { TaskScheduler, type ScheduledTask } from '../../core/runtime/task-scheduler.js';

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
  private messageSeenHandler: ((event: MessageSeenEvent) => Promise<void>) | null = null;
  private discordAdapter?: DiscordChannelAdapter;
  private eventRouter: EventRouter<TriggerEvent>;
  private taskScheduler: TaskScheduler<TriggerEvent>;

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
      // Note: lastProcessedMessageIds is now tracked via onMessageSeen for ALL messages,
      // not just processed ones. This prevents re-processing messages on restart.
    };

    this.eventRouter = new EventRouter<TriggerEvent>(onTrigger, callbacks, {
      name: `TriggerManager(${config.name})`,
      maxQueueSize: 100,
    });

    // Get scheduled task configs - use new format if available, fall back to old cron format
    const scheduledTaskConfigs: ScheduledTaskConfig[] = config.scheduledTasks ?? [];

    // Event factory to create TriggerEvent from scheduled task
    const taskEventFactory = (task: ScheduledTask, immediate: boolean): TriggerEvent => ({
      type: 'scheduled_task',
      source: task.name,
      payload: {
        taskId: task.id,
        taskName: task.name,
        taskSource: task.source,
        prompt: task.prompt,
        schedule: task.schedule,
        ...(immediate ? { immediate: true } : {}),
      },
      timestamp: new Date(),
    });

    this.taskScheduler = new TaskScheduler<TriggerEvent>(
      config.name,
      this.eventRouter,
      scheduledTaskConfigs,
      { defaultFireOnStart: true },
      taskEventFactory
    );
  }

  /**
   * Get the task scheduler for MCP tools access
   */
  getTaskScheduler(): TaskScheduler<TriggerEvent> {
    return this.taskScheduler;
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

    // Start task scheduler (handles all scheduled task setup and fire-on-start)
    await this.taskScheduler.start();

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

    // Stop task scheduler
    this.taskScheduler.stop();

    for (const interval of this.pollingIntervals) {
      clearInterval(interval);
    }
    this.pollingIntervals = [];

    // Remove Discord event listeners using the adapter
    if (this.discordAdapter) {
      if (this.messageHandler) {
        this.discordAdapter.offMessage(this.messageHandler);
        this.messageHandler = null;
      }
      if (this.messageSeenHandler) {
        this.discordAdapter.offMessageSeen(this.messageSeenHandler);
        this.messageSeenHandler = null;
      }
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

      // Get bot user ID for reply detection
      const botUserId = this.discordAdapter.getClient()?.user?.id;

      // Check channels the agent can read
      for (const channelName of discordConfig.canRead) {
        const lastSeenId = this.state.lastProcessedMessageIds[channelName];

        // Fetch last 50 messages from the channel
        const allMessages = await this.discordAdapter.readMessages({
          channel: channelName,
          limit: 50,
        });

        if (allMessages.length === 0) {
          continue;
        }

        // If no lastSeenId for this channel, initialize from the latest message and skip catch-up
        if (!lastSeenId) {
          const latestMessageId = allMessages[allMessages.length - 1].id;
          this.state.lastProcessedMessageIds[channelName] = latestMessageId;
          await saveState(this.config.name, this.state);
          logger.info('Initialized lastProcessedMessageId for channel, skipping catch-up', {
            channel: channelName,
            messageId: latestMessageId,
          });
          continue;
        }

        // Filter to messages after lastSeenId (messages we haven't seen yet)
        // Messages are in chronological order, so filter those with id > lastSeenId
        const missedMessages = allMessages.filter((msg) => msg.id > lastSeenId);

        if (missedMessages.length === 0) {
          continue;
        }

        logger.info('Catching up on missed messages', {
          channel: channelName,
          count: missedMessages.length,
          afterMessageId: lastSeenId,
        });

        // Process missed messages in chronological order
        for (const message of missedMessages) {
          // Mark message as seen (update lastProcessedMessageId)
          await this.updateLastProcessedMessageId(channelName, message.id);

          // Check if this message is a reply to one of this agent's messages
          const isReplyToAgent = await this.checkIsReplyToAgent(message, channelName, botUserId);

          // Use shared logic to determine if we should respond
          const { shouldRespond, isMention } = shouldRespondToMessage({
            message,
            myRole: discordConfig.role,
            botUserId,
            otherAgentRoles,
            primaryChannel: discordConfig.primary,
            onChannelMessage: discordConfig.triggers.onChannelMessage,
            isReplyToAgent,
          });

          if (shouldRespond) {
            const triggerType = isMention ? 'discord_mention' : 'discord_message';
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

  /**
   * Check if a message is a reply to one of this agent's messages
   */
  private async checkIsReplyToAgent(
    message: ChannelMessage,
    channelName: string,
    botUserId?: string
  ): Promise<boolean> {
    if (!message.replyTo || !botUserId || !this.discordAdapter) {
      return false;
    }

    try {
      const referencedMessage = await this.discordAdapter.fetchMessage(
        channelName,
        message.replyTo
      );
      return referencedMessage?.author.id === botUserId;
    } catch {
      logger.debug('Could not fetch referenced message for catch-up', {
        messageId: message.replyTo,
      });
      return false;
    }
  }

  private async setupDiscordEvents(): Promise<void> {
    if (!this.discordAdapter) {
      logger.warn('No Discord adapter provided, skipping Discord event setup');
      return;
    }

    // Register handler for ALL messages seen (for tracking lastProcessedMessageIds)
    // This fires for every message in readable channels, not just ones we respond to
    this.messageSeenHandler = async (event: MessageSeenEvent) => {
      await this.updateLastProcessedMessageId(event.channelName, event.messageId);
    };
    this.discordAdapter.onMessageSeen(this.messageSeenHandler);

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

  /**
   * Update lastProcessedMessageId for a channel
   * Only updates if the new messageId is greater than the current one
   */
  private async updateLastProcessedMessageId(
    channelName: string,
    messageId: string
  ): Promise<void> {
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
}
