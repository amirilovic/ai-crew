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
  TaskScheduler,
  createTaskScheduler,
  type ScheduledTaskConfig,
  type ScheduledTask,
  type ScheduledTaskEvent,
  type ScheduleTaskInput,
} from './task-scheduler.js';

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
  buildScheduledTaskPrompt,
  buildDiscordPrompt,
  getPromptVariables,
  substituteVariables,
  type PromptVariables,
} from './prompt-builder.js';
