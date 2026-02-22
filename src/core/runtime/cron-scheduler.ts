/**
 * CronScheduler - Config-driven cron job scheduling
 *
 * Schedules cron jobs based on configuration and emits events to an EventRouter.
 * Adapter-agnostic: works with any event consumer.
 */

import cron from 'node-cron';
import { logger } from '../../shared/logger.js';
import type { EventRouter, RouterEvent } from './event-router.js';

/**
 * Configuration for a single cron job
 */
export interface CronJobConfig {
  /** Cron expression (e.g., "0 * * * *" for every hour, "0/15 * * * *" for every 15 minutes) */
  schedule: string;
  /** Task name/identifier */
  task: string;
  /** Optional: Fire immediately on scheduler start */
  fireOnStart?: boolean;
}

/**
 * Options for creating a CronScheduler
 */
export interface CronSchedulerConfig {
  /** Name for logging purposes */
  name?: string;
  /** Default value for fireOnStart if not specified per job */
  defaultFireOnStart?: boolean;
}

/**
 * Event emitted when a cron job fires
 */
export interface CronEvent extends RouterEvent {
  type: 'cron';
  source: string; // task name
  payload: {
    schedule: string;
    task: string;
    /** True if this was fired immediately on startup */
    immediate?: boolean;
  };
}

/**
 * CronScheduler manages cron jobs and emits events when they fire.
 *
 * Features:
 * - Config-driven: reads schedules from provided configuration
 * - Integrates with EventRouter for event dispatch
 * - Optional fire-on-start for immediate trigger
 * - Clean start/stop lifecycle
 */
export class CronScheduler<T extends RouterEvent = CronEvent> {
  private jobs: cron.ScheduledTask[] = [];
  private eventRouter: EventRouter<T>;
  private configs: CronJobConfig[];
  private name: string;
  private defaultFireOnStart: boolean;
  private isRunning = false;
  private eventFactory: (config: CronJobConfig, immediate: boolean) => T;

  constructor(
    eventRouter: EventRouter<T>,
    configs: CronJobConfig[],
    options: CronSchedulerConfig = {},
    eventFactory?: (config: CronJobConfig, immediate: boolean) => T
  ) {
    this.eventRouter = eventRouter;
    this.configs = configs;
    this.name = options.name ?? 'CronScheduler';
    this.defaultFireOnStart = options.defaultFireOnStart ?? true;
    // Default event factory creates CronEvent
    this.eventFactory =
      eventFactory ??
      ((config, immediate) =>
        ({
          type: 'cron',
          source: config.task,
          payload: {
            schedule: config.schedule,
            task: config.task,
            ...(immediate ? { immediate: true } : {}),
          },
          timestamp: new Date(),
        }) as unknown as T);
  }

  /**
   * Start all configured cron jobs
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn(`${this.name}: Already running`);
      return;
    }

    this.isRunning = true;
    logger.info(`${this.name}: Starting`, { jobCount: this.configs.length });

    for (const config of this.configs) {
      // Validate cron expression
      if (!cron.validate(config.schedule)) {
        logger.error(`${this.name}: Invalid cron expression`, {
          task: config.task,
          schedule: config.schedule,
        });
        continue;
      }

      // Create the scheduled job
      const job = cron.schedule(config.schedule, async () => {
        await this.fireCronEvent(config, false);
      });

      this.jobs.push(job);
      logger.info(`${this.name}: Job scheduled`, {
        task: config.task,
        schedule: config.schedule,
      });

      // Fire immediately on start if configured
      const fireOnStart = config.fireOnStart ?? this.defaultFireOnStart;
      if (fireOnStart) {
        logger.info(`${this.name}: Firing immediately on startup`, { task: config.task });
        await this.fireCronEvent(config, true);
      }
    }
  }

  /**
   * Stop all cron jobs
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    logger.info(`${this.name}: Stopping`, { jobCount: this.jobs.length });

    for (const job of this.jobs) {
      job.stop();
    }
    this.jobs = [];
    this.isRunning = false;
  }

  /**
   * Get the number of active jobs
   */
  get jobCount(): number {
    return this.jobs.length;
  }

  /**
   * Check if the scheduler is running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Fire a cron event and enqueue it
   */
  private async fireCronEvent(config: CronJobConfig, immediate: boolean): Promise<void> {
    const event = this.eventFactory(config, immediate);

    logger.info(`${this.name}: Cron trigger fired`, {
      task: config.task,
      immediate,
    });

    await this.eventRouter.enqueue(event);
  }
}

/**
 * Create a CronScheduler with the given event router and job configurations
 */
export function createCronScheduler<T extends RouterEvent = CronEvent>(
  eventRouter: EventRouter<T>,
  configs: CronJobConfig[],
  options?: CronSchedulerConfig,
  eventFactory?: (config: CronJobConfig, immediate: boolean) => T
): CronScheduler<T> {
  return new CronScheduler(eventRouter, configs, options, eventFactory);
}
