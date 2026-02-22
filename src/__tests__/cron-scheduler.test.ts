import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CronScheduler,
  createCronScheduler,
  type CronJobConfig,
  type CronEvent,
} from '../core/runtime/cron-scheduler.js';
import { EventRouter, type RouterEvent } from '../core/runtime/event-router.js';

// Helper to wait for async operations
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('CronScheduler', () => {
  let handler: ReturnType<typeof vi.fn>;
  let eventRouter: EventRouter<CronEvent>;

  beforeEach(() => {
    handler = vi.fn(async () => {});
    eventRouter = new EventRouter<CronEvent>(handler);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor and configuration', () => {
    it('creates scheduler with provided config', () => {
      const configs: CronJobConfig[] = [{ schedule: '* * * * *', task: 'test-task' }];

      const scheduler = new CronScheduler(eventRouter, configs);

      expect(scheduler.running).toBe(false);
      expect(scheduler.jobCount).toBe(0);
    });

    it('accepts custom name in options', () => {
      const configs: CronJobConfig[] = [];
      const scheduler = new CronScheduler(eventRouter, configs, { name: 'CustomScheduler' });

      // Name is used for logging - we just verify it doesn't throw
      expect(scheduler.running).toBe(false);
    });
  });

  describe('start', () => {
    it('starts all configured jobs', async () => {
      const configs: CronJobConfig[] = [
        { schedule: '* * * * *', task: 'task-1', fireOnStart: false },
        { schedule: '0 * * * *', task: 'task-2', fireOnStart: false },
      ];

      const scheduler = new CronScheduler(eventRouter, configs, { defaultFireOnStart: false });
      await scheduler.start();

      expect(scheduler.running).toBe(true);
      expect(scheduler.jobCount).toBe(2);

      scheduler.stop();
    });

    it('fires immediately on start when fireOnStart is true', async () => {
      const configs: CronJobConfig[] = [
        { schedule: '0 0 1 1 *', task: 'yearly-task', fireOnStart: true }, // Yearly cron, won't fire normally
      ];

      const scheduler = new CronScheduler(eventRouter, configs);
      await scheduler.start();
      await flushPromises();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cron',
          source: 'yearly-task',
          payload: expect.objectContaining({
            immediate: true,
          }),
        })
      );

      scheduler.stop();
    });

    it('uses defaultFireOnStart when job config does not specify', async () => {
      const configs: CronJobConfig[] = [
        { schedule: '0 0 1 1 *', task: 'task-no-config' }, // No fireOnStart specified
      ];

      // defaultFireOnStart is true by default
      const scheduler = new CronScheduler(eventRouter, configs);
      await scheduler.start();
      await flushPromises();

      expect(handler).toHaveBeenCalledTimes(1);

      scheduler.stop();
    });

    it('does not fire on start when fireOnStart is false', async () => {
      const configs: CronJobConfig[] = [
        { schedule: '0 0 1 1 *', task: 'yearly-task', fireOnStart: false },
      ];

      const scheduler = new CronScheduler(eventRouter, configs, { defaultFireOnStart: false });
      await scheduler.start();
      await flushPromises();

      expect(handler).not.toHaveBeenCalled();

      scheduler.stop();
    });

    it('warns and skips invalid cron expressions', async () => {
      const configs: CronJobConfig[] = [
        { schedule: 'invalid-cron', task: 'invalid-task', fireOnStart: false },
        { schedule: '* * * * *', task: 'valid-task', fireOnStart: false },
      ];

      const scheduler = new CronScheduler(eventRouter, configs, { defaultFireOnStart: false });
      await scheduler.start();

      // Only valid job should be scheduled
      expect(scheduler.jobCount).toBe(1);

      scheduler.stop();
    });

    it('does nothing if already running', async () => {
      const configs: CronJobConfig[] = [
        { schedule: '* * * * *', task: 'task', fireOnStart: false },
      ];

      const scheduler = new CronScheduler(eventRouter, configs, { defaultFireOnStart: false });
      await scheduler.start();
      await scheduler.start(); // Second start should be ignored

      expect(scheduler.jobCount).toBe(1); // Still only 1 job

      scheduler.stop();
    });
  });

  describe('stop', () => {
    it('stops all running jobs', async () => {
      const configs: CronJobConfig[] = [
        { schedule: '* * * * *', task: 'task-1', fireOnStart: false },
        { schedule: '* * * * *', task: 'task-2', fireOnStart: false },
      ];

      const scheduler = new CronScheduler(eventRouter, configs, { defaultFireOnStart: false });
      await scheduler.start();
      expect(scheduler.running).toBe(true);
      expect(scheduler.jobCount).toBe(2);

      scheduler.stop();

      expect(scheduler.running).toBe(false);
      expect(scheduler.jobCount).toBe(0);
    });

    it('does nothing if not running', () => {
      const scheduler = new CronScheduler(eventRouter, []);

      // Should not throw
      scheduler.stop();

      expect(scheduler.running).toBe(false);
    });
  });

  describe('event emission', () => {
    it('emits cron events with correct structure', async () => {
      const configs: CronJobConfig[] = [
        { schedule: '0 0 1 1 *', task: 'test-task', fireOnStart: true },
      ];

      const scheduler = new CronScheduler(eventRouter, configs);
      await scheduler.start();
      await flushPromises();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cron',
          source: 'test-task',
          payload: {
            schedule: '0 0 1 1 *',
            task: 'test-task',
            immediate: true,
          },
          timestamp: expect.any(Date),
        })
      );

      scheduler.stop();
    });
  });

  describe('custom event factory', () => {
    it('uses custom event factory when provided', async () => {
      interface CustomEvent extends RouterEvent {
        type: 'custom';
        customField: string;
      }

      const customHandler = vi.fn(async () => {});
      const customRouter = new EventRouter<CustomEvent>(customHandler);

      const customFactory = (config: CronJobConfig, _immediate: boolean): CustomEvent => ({
        type: 'custom',
        source: config.task,
        payload: { schedule: config.schedule },
        timestamp: new Date(),
        customField: `custom-${config.task}`,
      });

      const configs: CronJobConfig[] = [{ schedule: '0 0 1 1 *', task: 'task', fireOnStart: true }];

      const scheduler = new CronScheduler<CustomEvent>(customRouter, configs, {}, customFactory);

      await scheduler.start();
      await flushPromises();

      expect(customHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'custom',
          customField: 'custom-task',
        })
      );

      scheduler.stop();
    });
  });

  describe('createCronScheduler factory', () => {
    it('creates a configured CronScheduler', async () => {
      const configs: CronJobConfig[] = [
        { schedule: '0 0 1 1 *', task: 'factory-task', fireOnStart: true },
      ];

      const scheduler = createCronScheduler(eventRouter, configs, { name: 'FactoryScheduler' });

      await scheduler.start();
      await flushPromises();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(scheduler.running).toBe(true);

      scheduler.stop();
    });
  });
});
