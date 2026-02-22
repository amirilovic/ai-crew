import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { logger } from '../logger.js';
import { CostTracker } from '../guardrails/cost-tracker.js';
import type { AgentContext } from '../types.js';
import type { DiscordChannelAdapter } from '../../core/channels/discord/adapter.js';
import { createDiscordMcpTools } from '../../core/channels/discord/tools.js';
import type { ReminderManager } from '../reminders/index.js';
import {
  runAgentLoop as runGenericAgentLoop,
  type AgentLoopConfig,
  type McpServerConfig,
} from '../../core/runtime/agent-loop.js';

interface RunLoopOptions {
  costTracker: CostTracker;
  onStatusUpdate?: (status: string) => Promise<void>;
  sessionId?: string; // Session ID to resume, if any
  reminderManager?: ReminderManager; // Optional reminder manager for scheduling tools
  discordAdapter?: DiscordChannelAdapter; // Discord channel adapter for MCP tools
}

export interface RunLoopResult {
  response: string;
  turns: number;
  costUsd: number;
  sessionId?: string; // Session ID for resumption
}

// Create spend reporting tool (not Discord-specific, so stays here)
function createSpendTool(costTracker: CostTracker) {
  return tool(
    'get_my_spend',
    "Get your current daily spend statistics. Shows how much of your daily budget you've used.",
    {},
    async () => {
      try {
        const stats = costTracker.getStats();
        const formatted = costTracker.formatStats();

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                stats,
                formatted,
              }),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to get spend stats', { error: errorMessage });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `Failed to get spend: ${errorMessage}` }),
            },
          ],
        };
      }
    }
  );
}

// Create Reminder tools for MCP
function createReminderTools(reminderManager: ReminderManager) {
  const scheduleReminderTool = tool(
    'schedule_reminder',
    'Schedule a reminder for yourself. Use ISO datetime for one-time reminders (e.g., "2025-01-15T09:00:00Z") or cron expressions for recurring (e.g., "0 9 * * *" for daily at 9am).',
    {
      message: z.string().describe('The reminder message - what you want to be reminded about'),
      when: z
        .string()
        .describe('ISO datetime string for one-time, or cron expression for recurring'),
      recurring: z
        .boolean()
        .default(false)
        .describe('Set to true for recurring reminders using cron expression'),
    },
    async (input) => {
      try {
        const reminder = await reminderManager.scheduleReminder({
          message: input.message,
          when: input.when,
          recurring: input.recurring,
        });

        logger.info('Reminder scheduled via MCP tool', {
          id: reminder.id,
          message: reminder.message,
          when: reminder.when,
          recurring: reminder.recurring,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                reminder: {
                  id: reminder.id,
                  message: reminder.message,
                  when: reminder.when,
                  recurring: reminder.recurring,
                  createdAt: reminder.createdAt,
                },
              }),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to schedule reminder', { error: errorMessage });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: errorMessage }),
            },
          ],
        };
      }
    }
  );

  const listRemindersTool = tool(
    'list_reminders',
    'List all your scheduled reminders.',
    {},
    async () => {
      try {
        const reminders = reminderManager.listReminders();
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                count: reminders.length,
                reminders: reminders.map((r) => ({
                  id: r.id,
                  message: r.message,
                  when: r.when,
                  recurring: r.recurring,
                  createdAt: r.createdAt,
                })),
              }),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to list reminders', { error: errorMessage });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: errorMessage }),
            },
          ],
        };
      }
    }
  );

  const cancelReminderTool = tool(
    'cancel_reminder',
    'Cancel a scheduled reminder by its ID.',
    {
      id: z.string().describe('The reminder ID to cancel'),
    },
    async (input) => {
      try {
        const cancelled = await reminderManager.cancelReminder(input.id);

        if (cancelled) {
          logger.info('Reminder cancelled via MCP tool', { id: input.id });
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  success: true,
                  message: `Reminder ${input.id} has been cancelled`,
                }),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  message: `Reminder ${input.id} not found`,
                }),
              },
            ],
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to cancel reminder', { error: errorMessage, id: input.id });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: errorMessage }),
            },
          ],
        };
      }
    }
  );

  return [scheduleReminderTool, listRemindersTool, cancelReminderTool];
}

/**
 * Run the agent loop for a specific agent context
 *
 * This function builds MCP tools from the provided adapters and delegates
 * to the generic runAgentLoop from core/runtime.
 */
export async function runAgentLoop(
  context: AgentContext,
  initialPrompt: string,
  options: RunLoopOptions
): Promise<RunLoopResult> {
  const { costTracker, onStatusUpdate, sessionId, reminderManager, discordAdapter } = options;

  // Build MCP server configs
  const mcpServers: McpServerConfig[] = [];

  // Discord tools (with spend tool bundled)
  const spendTool = createSpendTool(costTracker);
  const discordTools = discordAdapter
    ? [...createDiscordMcpTools(discordAdapter), spendTool]
    : [spendTool];
  mcpServers.push({
    name: 'discord-tools',
    tools: discordTools,
  });

  // Reminder tools (if manager provided)
  if (reminderManager) {
    const reminderTools = createReminderTools(reminderManager);
    mcpServers.push({
      name: 'reminder-tools',
      tools: reminderTools,
    });
  }

  // Build config for generic agent loop
  const config: AgentLoopConfig = {
    name: context.config.name,
    systemPrompt: context.systemPrompt,
    model: context.config.model,
    claudeExecutable: context.config.claudeExecutable,
    api: context.config.api,
  };

  // Run the generic agent loop
  return runGenericAgentLoop(config, initialPrompt, {
    costTracker,
    mcpServers,
    sessionId,
    onStatusUpdate,
  });
}
