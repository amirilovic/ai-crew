/**
 * Core Runtime Module
 *
 * Generic runtime components that are adapter-agnostic.
 */

export {
  EventRouter,
  createEventRouter,
  type RouterEvent,
  type EventHandler,
  type EventRouterCallbacks,
  type EventRouterConfig,
} from './event-router.js';

export {
  CronScheduler,
  createCronScheduler,
  type CronJobConfig,
  type CronSchedulerConfig,
  type CronEvent,
} from './cron-scheduler.js';

export {
  runAgentLoop,
  type AgentLoopConfig,
  type AgentLoopOptions,
  type AgentLoopResult,
  type McpServerConfig,
} from './agent-loop.js';

export {
  buildPromptFromTrigger,
  buildJournalContext,
  buildCronPrompt,
  buildDiscordPrompt,
  buildReminderPrompt,
  getPromptVariables,
  substituteVariables,
  findCronPrompt,
  type CronPromptConfig,
  type PromptVariables,
} from './prompt-builder.js';
