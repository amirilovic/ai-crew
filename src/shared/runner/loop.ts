import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { logger } from '../logger.js';
import { CostTracker } from '../guardrails/cost-tracker.js';
import type { AgentContext, TriggerEvent } from '../types.js';
import type { DiscordChannelAdapter } from '../../core/channels/discord/adapter.js';
import { createDiscordMcpTools } from '../../core/channels/discord/tools.js';
import type { TaskScheduler } from '../../core/runtime/task-scheduler.js';
import {
  runAgentLoop as runGenericAgentLoop,
  type AgentLoopConfig,
  type McpServerConfig,
} from '../../core/runtime/agent-loop.js';

interface RunLoopOptions {
  costTracker: CostTracker;
  onStatusUpdate?: (status: string) => Promise<void>;
  sessionId?: string; // Session ID to resume, if any
  taskScheduler?: TaskScheduler<TriggerEvent>; // Optional task scheduler for scheduling tools
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

// Create Task Scheduler tools for MCP
function createTaskSchedulerTools(taskScheduler: TaskScheduler<TriggerEvent>) {
  const scheduleTaskTool = tool(
    'schedule_task',
    'Schedule a task for yourself. Use ISO datetime for one-time tasks (e.g., "2025-01-15T09:00:00Z") or cron expressions for recurring (e.g., "0 9 * * *" for daily at 9am). Note: You can only schedule agent tasks, not modify system tasks.',
    {
      name: z.string().describe('A short name for this task'),
      schedule: z
        .string()
        .describe('ISO datetime string for one-time tasks, or cron expression for recurring'),
      prompt: z.string().describe('The prompt/instructions for when this task fires'),
      recurring: z
        .boolean()
        .default(false)
        .describe('Set to true for recurring tasks using cron expression'),
    },
    async (input) => {
      try {
        const task = await taskScheduler.scheduleAgentTask({
          name: input.name,
          schedule: input.schedule,
          prompt: input.prompt,
          recurring: input.recurring,
        });

        logger.info('Task scheduled via MCP tool', {
          id: task.id,
          name: task.name,
          schedule: task.schedule,
          recurring: task.recurring,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                task: {
                  id: task.id,
                  name: task.name,
                  schedule: task.schedule,
                  prompt: task.prompt,
                  recurring: task.recurring,
                  source: task.source,
                  createdAt: task.createdAt,
                },
              }),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to schedule task', { error: errorMessage });
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

  const listTasksTool = tool(
    'list_tasks',
    'List all scheduled tasks. Filter by source: "all" (default), "system" (config-defined, read-only), or "agent" (runtime-created, modifiable).',
    {
      source: z.enum(['all', 'system', 'agent']).default('all').describe('Filter tasks by source'),
    },
    async (input) => {
      try {
        const tasks = taskScheduler.listTasks(input.source);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                count: tasks.length,
                tasks: tasks.map((t) => ({
                  id: t.id,
                  name: t.name,
                  schedule: t.schedule,
                  prompt: t.prompt.substring(0, 100) + (t.prompt.length > 100 ? '...' : ''),
                  recurring: t.recurring,
                  source: t.source,
                  enabled: t.enabled,
                  createdAt: t.createdAt,
                })),
              }),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to list tasks', { error: errorMessage });
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

  const cancelTaskTool = tool(
    'cancel_task',
    'Cancel a scheduled task by its ID. Note: You can only cancel agent tasks, not system tasks.',
    {
      id: z.string().describe('The task ID to cancel'),
    },
    async (input) => {
      try {
        const cancelled = await taskScheduler.cancelTask(input.id);

        if (cancelled) {
          logger.info('Task cancelled via MCP tool', { id: input.id });
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  success: true,
                  message: `Task ${input.id} has been cancelled`,
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
                  message: `Task ${input.id} not found or is a system task (cannot cancel system tasks)`,
                }),
              },
            ],
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to cancel task', { error: errorMessage, id: input.id });
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

  return [scheduleTaskTool, listTasksTool, cancelTaskTool];
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
  const { costTracker, onStatusUpdate, sessionId, taskScheduler, discordAdapter } = options;

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

  // Task scheduler tools (if scheduler provided)
  if (taskScheduler) {
    const taskTools = createTaskSchedulerTools(taskScheduler);
    mcpServers.push({
      name: 'task-scheduler-tools',
      tools: taskTools,
    });
  }

  // Build config for generic agent loop
  const config: AgentLoopConfig = {
    name: context.config.name,
    systemPrompt: context.systemPrompt,
    model: context.config.model,
    claudeExecutable: context.config.claudeExecutable,
    api: context.config.api,
    conversationTimeoutMs: context.config.runtime?.conversationTimeoutMs,
  };

  // Run the generic agent loop
  return runGenericAgentLoop(config, initialPrompt, {
    costTracker,
    mcpServers,
    sessionId,
    onStatusUpdate,
  });
}
