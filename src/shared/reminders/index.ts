import cron from 'node-cron';
import { randomUUID } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';
import type { Reminder, RemindersFile, ScheduleReminderInput } from './types.js';
import type { TriggerEvent } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

type ReminderHandler = (event: TriggerEvent) => Promise<void>;

export class ReminderManager {
  private agentName: string;
  private reminders: Reminder[] = [];
  private cronJobs: Map<string, cron.ScheduledTask> = new Map();
  private timeouts: Map<string, NodeJS.Timeout> = new Map();
  private onReminder: ReminderHandler | null = null;
  private dataPath: string;

  constructor(agentName: string) {
    this.agentName = agentName;
    this.dataPath = join(__dirname, '..', '..', '..', 'data', 'reminders', `${agentName}.json`);
  }

  /**
   * Set the handler that will be called when a reminder fires
   */
  setHandler(handler: ReminderHandler): void {
    this.onReminder = handler;
  }

  /**
   * Load reminders from disk and schedule them
   */
  async start(): Promise<void> {
    await this.loadReminders();
    this.scheduleAllReminders();
    logger.info('ReminderManager started', {
      agent: this.agentName,
      reminderCount: this.reminders.length,
    });
  }

  /**
   * Stop all scheduled reminders
   */
  stop(): void {
    for (const job of this.cronJobs.values()) {
      job.stop();
    }
    this.cronJobs.clear();

    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();

    logger.info('ReminderManager stopped', { agent: this.agentName });
  }

  /**
   * Schedule a new reminder
   */
  async scheduleReminder(input: ScheduleReminderInput): Promise<Reminder> {
    const reminder: Reminder = {
      id: randomUUID(),
      message: input.message,
      when: input.when,
      recurring: input.recurring ?? false,
      createdAt: new Date().toISOString(),
    };

    this.reminders.push(reminder);
    await this.saveReminders();
    this.scheduleReminder_(reminder);

    logger.info('Reminder scheduled', {
      id: reminder.id,
      message: reminder.message,
      when: reminder.when,
      recurring: reminder.recurring,
    });

    return reminder;
  }

  /**
   * List all reminders
   */
  listReminders(): Reminder[] {
    return [...this.reminders];
  }

  /**
   * Cancel a reminder by ID
   */
  async cancelReminder(id: string): Promise<boolean> {
    const index = this.reminders.findIndex((r) => r.id === id);
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
    this.reminders.splice(index, 1);
    await this.saveReminders();

    logger.info('Reminder cancelled', { id });
    return true;
  }

  private async loadReminders(): Promise<void> {
    try {
      const content = await readFile(this.dataPath, 'utf-8');
      const data: RemindersFile = JSON.parse(content);
      this.reminders = data.reminders || [];
      logger.info('Loaded reminders from file', {
        agent: this.agentName,
        count: this.reminders.length,
      });
    } catch {
      logger.info('No existing reminders file, starting fresh', { agent: this.agentName });
      this.reminders = [];
    }
  }

  private async saveReminders(): Promise<void> {
    try {
      const dir = dirname(this.dataPath);
      await mkdir(dir, { recursive: true });
      const data: RemindersFile = { reminders: this.reminders };
      await writeFile(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save reminders', { error });
    }
  }

  private scheduleAllReminders(): void {
    for (const reminder of this.reminders) {
      this.scheduleReminder_(reminder);
    }
  }

  private scheduleReminder_(reminder: Reminder): void {
    if (reminder.recurring) {
      // Recurring reminder - use cron
      if (!cron.validate(reminder.when)) {
        logger.error('Invalid cron expression for reminder', {
          id: reminder.id,
          when: reminder.when,
        });
        return;
      }

      const job = cron.schedule(reminder.when, () => {
        this.fireReminder(reminder);
      });
      this.cronJobs.set(reminder.id, job);
      logger.debug('Scheduled recurring reminder', {
        id: reminder.id,
        cron: reminder.when,
      });
    } else {
      // One-time reminder - use setTimeout
      const targetTime = new Date(reminder.when).getTime();
      const now = Date.now();
      const delay = targetTime - now;

      if (delay <= 0) {
        // Already past - fire immediately and clean up
        logger.info('One-time reminder is past due, firing immediately', {
          id: reminder.id,
        });
        this.fireReminder(reminder);
        this.cleanupOneTimeReminder(reminder.id);
        return;
      }

      const timeout = setTimeout(() => {
        this.fireReminder(reminder);
        this.cleanupOneTimeReminder(reminder.id);
      }, delay);
      this.timeouts.set(reminder.id, timeout);
      logger.debug('Scheduled one-time reminder', {
        id: reminder.id,
        when: reminder.when,
        delayMs: delay,
      });
    }
  }

  private async fireReminder(reminder: Reminder): Promise<void> {
    logger.info('Reminder fired', {
      id: reminder.id,
      message: reminder.message,
    });

    if (this.onReminder) {
      const event: TriggerEvent = {
        type: 'reminder',
        source: `reminder:${reminder.id}`,
        payload: {
          reminderId: reminder.id,
          message: reminder.message,
          recurring: reminder.recurring,
        },
        timestamp: new Date(),
      };

      try {
        await this.onReminder(event);
      } catch (error) {
        logger.error('Error handling reminder', { id: reminder.id, error });
      }
    }
  }

  private async cleanupOneTimeReminder(id: string): Promise<void> {
    this.timeouts.delete(id);
    const index = this.reminders.findIndex((r) => r.id === id);
    if (index !== -1) {
      this.reminders.splice(index, 1);
      await this.saveReminders();
      logger.info('One-time reminder cleaned up', { id });
    }
  }
}

export type { Reminder, ScheduleReminderInput } from './types.js';
