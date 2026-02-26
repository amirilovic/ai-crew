import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { ChannelType, TextChannel, Message } from 'discord.js';
import { logger } from '../logger.js';
import { CostTracker } from '../guardrails/cost-tracker.js';
import { CooldownManager } from '../guardrails/cooldown.js';
import { TriggerManager, loadState, saveState } from './triggers.js';
import { runAgentLoop } from './loop.js';
import { loadAgentEnv } from '../../config/environment.js';
import { checkAndApplyUpdate, formatUpdateNotification } from '../auto-update/index.js';
import { getStartupInfo } from '../startup-info.js';
import {
  createDiscordAdapter,
  DiscordChannelAdapter,
} from '../../core/channels/discord/adapter.js';
import { buildPromptFromTrigger } from '../../core/runtime/prompt-builder.js';
import type { AgentConfig, AgentContext, TriggerEvent } from '../types.js';
import { getDiscordConfig } from '../types.js';
import { initializeAgentRoles, getOtherAgentRoles } from '../agent-discovery.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Generate unique instance ID for this process (helps identify multiple instances)
const INSTANCE_ID = randomBytes(4).toString('hex');

export interface LoadedAgent {
  config: AgentConfig;
  systemPrompt: string;
  costTracker: CostTracker;
  cooldownManager: CooldownManager;
  triggerManager: TriggerManager;
  discordAdapter: DiscordChannelAdapter;
}

export async function loadAgent(agentName: string): Promise<LoadedAgent> {
  // Load agent-specific .env file first (overrides base .env)
  loadAgentEnv(agentName);

  const agentDir = join(__dirname, '..', '..', 'agents', agentName);

  logger.info('Loading agent', { agentName, agentDir });

  // Load config
  const configPath = join(agentDir, 'config.json');
  const configContent = await readFile(configPath, 'utf-8');
  const config: AgentConfig = JSON.parse(configContent);

  // Load system prompt (CLAUDE.md)
  const promptPath = join(agentDir, 'CLAUDE.md');
  const systemPrompt = await readFile(promptPath, 'utf-8');

  // Initialize guardrails
  const costTracker = new CostTracker({
    maxDailyCostUsd: config.limits.maxDailyCostUsd,
    agentName: agentName,
  });
  const cooldownManager = new CooldownManager(config.limits.cooldownMinutes);

  // Discover all agent roles from config files
  await initializeAgentRoles();

  // Create Discord adapter with dynamically discovered roles
  const discordConfig = getDiscordConfig(config);
  const otherAgentRoles = getOtherAgentRoles(discordConfig.role);
  const discordAdapter = createDiscordAdapter({
    agentConfig: config,
    otherAgentRoles,
  });

  // Create trigger manager with adapter (handler will be set by startAgent)
  // TaskScheduler is now integrated into TriggerManager
  const triggerManager = new TriggerManager(config, async () => {}, discordAdapter);

  logger.info('Agent loaded successfully', {
    agentName,
    model: config.model,
  });

  return {
    config,
    systemPrompt,
    costTracker,
    cooldownManager,
    triggerManager,
    discordAdapter,
  };
}

/**
 * Check for updates and notify via Discord if updated
 */
async function performUpdateCheck(
  agentName: string,
  discordAdapter?: DiscordChannelAdapter
): Promise<void> {
  try {
    const autoUpdateEnabled = process.env.AUTO_UPDATE_ENABLED !== 'false';
    if (!autoUpdateEnabled) {
      logger.debug('Auto-update disabled');
      return;
    }

    logger.info('Checking for updates...');
    const result = await checkAndApplyUpdate({ enabled: true });

    if (result.updated) {
      const notification = formatUpdateNotification(result, agentName);
      logger.info('Update applied', {
        previous: result.previousCommit?.substring(0, 7),
        current: result.currentCommit.substring(0, 7),
      });

      // Notify via Discord using the adapter
      if (discordAdapter && notification) {
        try {
          await discordAdapter.sendMessage({
            channel: 'development',
            content: notification,
          });
        } catch (e) {
          logger.warn('Failed to send update notification to Discord', { error: e });
        }
      }
    } else if (result.error) {
      logger.warn('Update check failed', { error: result.error });
    } else {
      logger.debug('No updates available');
    }
  } catch (error) {
    logger.error('Update check error', { error });
  }
}

export async function startAgent(agent: LoadedAgent): Promise<void> {
  const startupInfo = getStartupInfo();

  logger.info('Starting agent', {
    agentName: agent.config.name,
    instanceId: INSTANCE_ID,
    pid: process.pid,
    startupTime: startupInfo.startupTime,
    gitCommit: startupInfo.gitCommitShort,
  });

  // Connect the Discord adapter
  await agent.discordAdapter.connect();

  // Check for updates on startup
  await performUpdateCheck(agent.config.name, agent.discordAdapter);

  // Load persisted state including session ID
  const agentState = await loadState(agent.config.name);

  const handleTrigger = async (event: TriggerEvent): Promise<void> => {
    logger.info('Processing trigger event', {
      type: event.type,
      source: event.source,
      instanceId: INSTANCE_ID,
    });

    // Check cooldown for ticket-based events
    const ticketId = extractTicketId(event);
    if (ticketId && agent.cooldownManager.isOnCooldown(ticketId)) {
      const remaining = agent.cooldownManager.getRemainingCooldown(ticketId);
      logger.info('Skipping event due to cooldown', { ticketId, remainingSeconds: remaining });
      return;
    }

    // Status message for Discord - shows what agent is doing
    let statusMessage: Message | null = null;

    if (
      (event.type === 'discord_mention' || event.type === 'discord_message') &&
      event.payload.channelId
    ) {
      try {
        // Use the adapter's underlying client for status messages (need direct message reference)
        const guild = agent.discordAdapter.getGuild();
        const channel = guild?.channels.cache.get(
          event.payload.channelId as string
        ) as TextChannel | null;

        if (channel && channel.type === ChannelType.GuildText) {
          // Send initial status message
          statusMessage = await channel.send('🤔 Thinking...');
          logger.debug('Status message created', {
            channel: channel.name,
            messageId: statusMessage.id,
          });
        }
      } catch (_e) {
        // Ignore status message errors
        logger.debug('Failed to create status message');
      }
    }

    // Status update callback for the agent loop
    const onStatusUpdate = async (status: string): Promise<void> => {
      if (statusMessage) {
        try {
          await statusMessage.edit(status);
        } catch (_e) {
          // Ignore edit errors (message might be deleted)
        }
      }
    };

    // Build context
    const context: AgentContext = {
      config: agent.config,
      systemPrompt: agent.systemPrompt,
      conversationHistory: [],
    };

    // Build prompt based on trigger type (reads prompts from config)
    const prompt = buildPromptFromTrigger(event, agent.config);

    try {
      const result = await runAgentLoop(context, prompt, {
        costTracker: agent.costTracker,
        onStatusUpdate,
        sessionId: agentState.sessionId, // Resume previous session if exists
        taskScheduler: agent.triggerManager.getTaskScheduler(), // Enable task scheduling MCP tools
        discordAdapter: agent.discordAdapter, // Enable Discord MCP tools
      });

      logger.info('Agent run completed', {
        triggerType: event.type,
        responseLength: result.response.length,
        turns: result.turns,
        costUsd: result.costUsd.toFixed(4),
        sessionId: result.sessionId,
      });

      // Save session ID for next run
      // IMPORTANT: Reload state first to avoid overwriting TriggerManager's updates
      // (TriggerManager updates lastProcessedMessageIds independently)
      if (result.sessionId) {
        const currentState = await loadState(agent.config.name);
        currentState.sessionId = result.sessionId;
        await saveState(agent.config.name, currentState);
        logger.info('Session state saved', { sessionId: result.sessionId });
      }

      // Start cooldown if applicable
      if (ticketId) {
        agent.cooldownManager.startCooldown(ticketId);
      }

      // Delete status message when done (agent posts its own response)
      if (statusMessage) {
        try {
          await statusMessage.delete();
          logger.debug('Status message deleted');
        } catch (_e) {
          // Ignore delete errors
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorDetails =
        error instanceof Error ? { message: error.message, stack: error.stack } : error;
      logger.error('Agent run failed', {
        error: errorDetails,
        instanceId: INSTANCE_ID,
        triggerType: event.type,
        triggerSource: event.source,
      });

      // Update status message with error (don't delete it)
      // Include instance ID to help diagnose multiple instance issues
      if (statusMessage) {
        try {
          // Truncate error message for Discord (max ~100 chars)
          const shortError =
            errorMessage.length > 80 ? errorMessage.substring(0, 77) + '...' : errorMessage;
          await statusMessage.edit(
            `❌ Something went wrong. Please try again.\n\`\`\`\n${shortError}\n\`\`\``
          );
        } catch (_e) {
          // Ignore status message edit errors
        }
      }
    }
  };

  // Create new trigger manager with handler and adapter
  // TaskScheduler is integrated into TriggerManager and starts automatically
  agent.triggerManager = new TriggerManager(agent.config, handleTrigger, agent.discordAdapter);
  await agent.triggerManager.start();

  // Set up periodic update checks (every 10 minutes)
  const updateIntervalMs = 10 * 60 * 1000; // 10 minutes
  const updateInterval = setInterval(() => {
    performUpdateCheck(agent.config.name, agent.discordAdapter);
  }, updateIntervalMs);

  // Keep process running
  logger.info('Agent is running. Press Ctrl+C to stop.');

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down...');
    clearInterval(updateInterval);
    agent.triggerManager.stop();
    await agent.discordAdapter.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    clearInterval(updateInterval);
    agent.triggerManager.stop();
    await agent.discordAdapter.disconnect();
    process.exit(0);
  });
}

function extractTicketId(event: TriggerEvent): string | null {
  if (event.type === 'discord_mention') {
    return event.payload.messageId as string;
  }
  return null;
}

export { runAgentLoop } from './loop.js';
export { TriggerManager } from './triggers.js';
