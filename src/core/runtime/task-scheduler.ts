/**
 * TaskScheduler - Unified scheduling for both system and agent tasks
 *
 * Replaces both CronScheduler and ReminderManager with a single implementation.
 *
 * Two types of tasks (same format, different storage):
 * - System tasks: Defined in config.json, git-tracked, read-only at runtime
 * - Agent tasks: Created via MCP tools, persisted to data/tasks/{agent}.json
 */

import cron from 'node-cron';
import { randomUUID } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../shared/logger.js';
import type { EventRouter, RouterEvent } from './event-router.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Config format for system tasks (in agent config.json, git-tracked)
 */
export interface ScheduledTaskConfig {
  /** Human-readable name */
  name: string;
  /** Cron expression */
  schedule: string;
  /** Full prompt text (no hard-coding!) */
  prompt: string;
  /** Whether task is enabled (default: true) */
  enabled?: boolean;
  /** Run immediately on startup (default: true) */
  fireOnStart?: boolean;
}

/**
 * Runtime task (used internally, merges system + agent tasks)
 */
export interface ScheduledTask {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Cron expression (recurring) OR ISO datetime (one-time) */
  schedule: string;
  /** Full prompt text */
  prompt: string;
  /** true = cron-based recurring, false = one-time */
  recurring: boolean;
  /** Whether task is enabled */
  enabled: boolean;
  /** system = from config (read-only), agent = from MCP (read-write) */
  source: 'system' | 'agent';
  /** ISO timestamp of when task was created */
  createdAt: string;
}

/**
 * Event emitted when a scheduled task fires
 */
export interface ScheduledTaskEvent extends RouterEvent {
  type: 'scheduled_task';
  source: string; // task name
  payload: {
    taskId: string;
    taskName: string;
    taskSource: 'system' | 'agent';
    prompt: string;
    schedule: string;
    immediate?: boolean;
  };
}

/**
 * Persisted agent tasks file format
 */
interface AgentTasksFile {
  tasks: ScheduledTask[];
}

/**
 * Input for scheduling a new agent task
 */
export interface ScheduleTaskInput {
  name: string;
  schedule: string; // Cron for recurring, ISO datetime for one-time
  prompt: string;
  recurring?: boolean; // default: false
}

/**
 * TaskScheduler manages both system and agent scheduled tasks.
 *
 * Features:
 * - System tasks: Loaded from config on startup (read-only)
 * - Agent tasks: Persisted to data/tasks/{agent}.json (read-write via MCP)
 * - Uses node-cron for recurring tasks
 * - Uses setTimeout for one-time tasks
 * - Emits ScheduledTaskEvent through EventRouter
 */
export class TaskScheduler<T extends RouterEvent = ScheduledTaskEvent> {
  private agentName: string;
  private systemTasks: ScheduledTask[] = [];
  private agentTasks: ScheduledTask[] = [];
  private cronJobs: Map<string, cron.ScheduledTask> = new Map();
  private timeouts: Map<string, NodeJS.Timeout> = new Map();
  private eventRouter: EventRouter<T>;
  private dataPath: string;
  private eventFactory: (task: ScheduledTask, immediate: boolean) => T;
  private isRunning = false;
  private defaultFireOnStart: boolean;

  constructor(
    agentName: string,
    eventRouter: EventRouter<T>,
    systemTaskConfigs: ScheduledTaskConfig[] = [],
    options: { defaultFireOnStart?: boolean } = {},
    eventFactory?: (task: ScheduledTask, immediate: boolean) => T
  ) {
    this.agentName = agentName;
    this.eventRouter = eventRouter;
    this.dataPath = join(__dirname, '..', '..', '..', 'data', 'tasks', `${agentName}.json`);
    this.defaultFireOnStart = options.defaultFireOnStart ?? true;

    // Convert system task configs to ScheduledTask format
    this.systemTasks = systemTaskConfigs
      .filter((config) => config.enabled !== false)
      .map((config) => ({
        id: `system-${config.name}`,
        name: config.name,
        schedule: config.schedule,
        prompt: config.prompt,
        recurring: true, // System tasks are always recurring
        enabled: config.enabled !== false,
        source: 'system' as const,
        createdAt: new Date().toISOString(),
      }));

    // Default event factory creates ScheduledTaskEvent
    this.eventFactory =
      eventFactory ??
      ((task, immediate) =>
        ({
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
        }) as unknown as T);
  }

  /**
   * Start the scheduler - load agent tasks and schedule all tasks
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn(`TaskScheduler(${this.agentName}): Already running`);
      return;
    }

    // Load persisted agent tasks
    await this.loadAgentTasks();

    this.isRunning = true;
    const totalTasks = this.systemTasks.length + this.agentTasks.length;
    logger.info(`TaskScheduler(${this.agentName}): Starting`, {
      systemTasks: this.systemTasks.length,
      agentTasks: this.agentTasks.length,
      total: totalTasks,
    });

    // Schedule all system tasks
    for (const task of this.systemTasks) {
      await this.scheduleTask_(task, this.defaultFireOnStart);
    }

    // Schedule all agent tasks
    for (const task of this.agentTasks) {
      // Don't fire agent tasks on start - they have their own schedule
      this.scheduleTask_(task, false);
    }
  }

  /**
   * Stop all scheduled tasks
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    logger.info(`TaskScheduler(${this.agentName}): Stopping`);

    // Stop all cron jobs
    for (const job of this.cronJobs.values()) {
      job.stop();
    }
    this.cronJobs.clear();

    // Clear all timeouts
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();

    this.isRunning = false;
  }

  /**
   * Schedule a new agent task (via MCP tool)
   */
  async scheduleAgentTask(input: ScheduleTaskInput): Promise<ScheduledTask> {
    const task: ScheduledTask = {
      id: randomUUID(),
      name: input.name,
      schedule: input.schedule,
      prompt: input.prompt,
      recurring: input.recurring ?? false,
      enabled: true,
      source: 'agent',
      createdAt: new Date().toISOString(),
    };

    this.agentTasks.push(task);
    await this.saveAgentTasks();

    // Schedule immediately if we're running
    if (this.isRunning) {
      this.scheduleTask_(task, false);
    }

    logger.info(`TaskScheduler(${this.agentName}): Agent task scheduled`, {
      id: task.id,
      name: task.name,
      schedule: task.schedule,
      recurring: task.recurring,
    });

    return task;
  }

  /**
   * List all tasks (optionally filtered by source)
   */
  listTasks(source?: 'all' | 'system' | 'agent'): ScheduledTask[] {
    switch (source) {
      case 'system':
        return [...this.systemTasks];
      case 'agent':
        return [...this.agentTasks];
      case 'all':
      default:
        return [...this.systemTasks, ...this.agentTasks];
    }
  }

  /**
   * Cancel an agent task by ID
   * Note: System tasks cannot be cancelled at runtime
   */
  async cancelTask(id: string): Promise<boolean> {
    // Check if it's a system task - cannot cancel those
    if (this.systemTasks.some((t) => t.id === id)) {
      logger.warn(`TaskScheduler(${this.agentName}): Cannot cancel system task`, { id });
      return false;
    }

    const index = this.agentTasks.findIndex((t) => t.id === id);
    if (index === -1) {
      return false;
    }

    // Stop the scheduled job/timeout
    const cronJob = this.cronJobs.get(id);
    if (cronJob) {
      cronJob.stop();
      this.cronJobs.delete(id);
    }

    const timeout = this.timeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(id);
    }

    // Remove from list and save
    this.agentTasks.splice(index, 1);
    await this.saveAgentTasks();

    logger.info(`TaskScheduler(${this.agentName}): Agent task cancelled`, { id });
    return true;
  }

  /**
   * Get count of active tasks
   */
  get taskCount(): number {
    return this.systemTasks.length + this.agentTasks.length;
  }

  /**
   * Check if scheduler is running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Load agent tasks from disk
   */
  private async loadAgentTasks(): Promise<void> {
    try {
      const content = await readFile(this.dataPath, 'utf-8');
      const data: AgentTasksFile = JSON.parse(content);
      this.agentTasks = data.tasks || [];
      logger.info(`TaskScheduler(${this.agentName}): Loaded agent tasks from file`, {
        count: this.agentTasks.length,
      });
    } catch {
      logger.info(`TaskScheduler(${this.agentName}): No existing tasks file, starting fresh`);
      this.agentTasks = [];
    }
  }

  /**
   * Save agent tasks to disk
   */
  private async saveAgentTasks(): Promise<void> {
    try {
      const dir = dirname(this.dataPath);
      await mkdir(dir, { recursive: true });
      const data: AgentTasksFile = { tasks: this.agentTasks };
      await writeFile(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error(`TaskScheduler(${this.agentName}): Failed to save tasks`, { error });
    }
  }

  /**
   * Schedule a task internally
   */
  private async scheduleTask_(task: ScheduledTask, fireOnStart: boolean): Promise<void> {
    if (task.recurring) {
      // Recurring task - use cron
      if (!cron.validate(task.schedule)) {
        logger.error(`TaskScheduler(${this.agentName}): Invalid cron expression`, {
          id: task.id,
          name: task.name,
          schedule: task.schedule,
        });
        return;
      }

      const job = cron.schedule(task.schedule, async () => {
        await this.fireTaskEvent(task, false);
      });

      this.cronJobs.set(task.id, job);
      logger.info(`TaskScheduler(${this.agentName}): Recurring task scheduled`, {
        id: task.id,
        name: task.name,
        schedule: task.schedule,
      });

      // Fire immediately on start if configured
      if (fireOnStart) {
        logger.info(`TaskScheduler(${this.agentName}): Firing task immediately on startup`, {
          name: task.name,
        });
        await this.fireTaskEvent(task, true);
      }
    } else {
      // One-time task - use setTimeout
      const targetTime = new Date(task.schedule).getTime();
      const now = Date.now();
      const delay = targetTime - now;

      if (delay <= 0) {
        // Already past - fire immediately and clean up
        logger.info(
          `TaskScheduler(${this.agentName}): One-time task is past due, firing immediately`,
          {
            id: task.id,
            name: task.name,
          }
        );
        await this.fireTaskEvent(task, false);
        await this.cleanupOneTimeTask(task.id);
        return;
      }

      const timeout = setTimeout(async () => {
        await this.fireTaskEvent(task, false);
        await this.cleanupOneTimeTask(task.id);
      }, delay);

      this.timeouts.set(task.id, timeout);
      logger.debug(`TaskScheduler(${this.agentName}): One-time task scheduled`, {
        id: task.id,
        name: task.name,
        when: task.schedule,
        delayMs: delay,
      });
    }
  }

  /**
   * Fire a task event and enqueue it
   */
  private async fireTaskEvent(task: ScheduledTask, immediate: boolean): Promise<void> {
    const event = this.eventFactory(task, immediate);

    logger.info(`TaskScheduler(${this.agentName}): Task fired`, {
      id: task.id,
      name: task.name,
      source: task.source,
      immediate,
    });

    await this.eventRouter.enqueue(event);
  }

  /**
   * Clean up a one-time task after it fires
   */
  private async cleanupOneTimeTask(id: string): Promise<void> {
    this.timeouts.delete(id);
    const index = this.agentTasks.findIndex((t) => t.id === id);
    if (index !== -1) {
      this.agentTasks.splice(index, 1);
      await this.saveAgentTasks();
      logger.info(`TaskScheduler(${this.agentName}): One-time task cleaned up`, { id });
    }
  }
}

/**
 * Create a TaskScheduler with the given configuration
 */
export function createTaskScheduler<T extends RouterEvent = ScheduledTaskEvent>(
  agentName: string,
  eventRouter: EventRouter<T>,
  systemTaskConfigs?: ScheduledTaskConfig[],
  options?: { defaultFireOnStart?: boolean },
  eventFactory?: (task: ScheduledTask, immediate: boolean) => T
): TaskScheduler<T> {
  return new TaskScheduler(agentName, eventRouter, systemTaskConfigs, options, eventFactory);
}
