import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TaskScheduler,
  createTaskScheduler,
  type ScheduledTaskConfig,
  type ScheduledTaskEvent,
} from '../core/runtime/task-scheduler.js';
import { EventRouter } from '../core/runtime/event-router.js';
import { rm, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDataDir = join(__dirname, '..', '..', 'data', 'tasks');

// Helper to wait for async operations
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('TaskScheduler', () => {
  let handler: ReturnType<typeof vi.fn>;
  let eventRouter: EventRouter<ScheduledTaskEvent>;
  const testAgentName = 'test-agent';

  beforeEach(async () => {
    handler = vi.fn(async () => {});
    eventRouter = new EventRouter<ScheduledTaskEvent>(handler);

    // Clean up test data
    try {
      await rm(join(testDataDir, `${testAgentName}.json`), { force: true });
    } catch {
      // Ignore if doesn't exist
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor and configuration', () => {
    it('creates scheduler with provided config', () => {
      const configs: ScheduledTaskConfig[] = [
        { name: 'test-task', schedule: '* * * * *', prompt: 'Test prompt' },
      ];

      const scheduler = new TaskScheduler(testAgentName, eventRouter, configs);

      expect(scheduler.running).toBe(false);
      expect(scheduler.taskCount).toBe(1); // System tasks are loaded immediately
    });

    it('handles empty config', () => {
      const scheduler = new TaskScheduler(testAgentName, eventRouter, []);
      expect(scheduler.taskCount).toBe(0);
    });
  });

  describe('start', () => {
    it('starts all configured system tasks', async () => {
      const configs: ScheduledTaskConfig[] = [
        { name: 'task-1', schedule: '* * * * *', prompt: 'Prompt 1', fireOnStart: false },
        { name: 'task-2', schedule: '0 * * * *', prompt: 'Prompt 2', fireOnStart: false },
      ];

      const scheduler = new TaskScheduler(testAgentName, eventRouter, configs, {
        defaultFireOnStart: false,
      });
      await scheduler.start();

      expect(scheduler.running).toBe(true);
      expect(scheduler.taskCount).toBe(2);

      scheduler.stop();
    });

    it('fires immediately on start when fireOnStart is true', async () => {
      const configs: ScheduledTaskConfig[] = [
        { name: 'yearly-task', schedule: '0 0 1 1 *', prompt: 'Fire now!', fireOnStart: true },
      ];

      const scheduler = new TaskScheduler(testAgentName, eventRouter, configs);
      await scheduler.start();
      await flushPromises();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scheduled_task',
          source: 'yearly-task',
          payload: expect.objectContaining({
            immediate: true,
            taskSource: 'system',
          }),
        })
      );

      scheduler.stop();
    });

    it('uses defaultFireOnStart when task config does not specify', async () => {
      const configs: ScheduledTaskConfig[] = [
        { name: 'task-no-config', schedule: '0 0 1 1 *', prompt: 'Test' }, // No fireOnStart
      ];

      // defaultFireOnStart is true by default
      const scheduler = new TaskScheduler(testAgentName, eventRouter, configs);
      await scheduler.start();
      await flushPromises();

      expect(handler).toHaveBeenCalledTimes(1);

      scheduler.stop();
    });

    it('does not fire on start when fireOnStart is false', async () => {
      const configs: ScheduledTaskConfig[] = [
        { name: 'yearly-task', schedule: '0 0 1 1 *', prompt: 'Test', fireOnStart: false },
      ];

      const scheduler = new TaskScheduler(testAgentName, eventRouter, configs, {
        defaultFireOnStart: false,
      });
      await scheduler.start();
      await flushPromises();

      expect(handler).not.toHaveBeenCalled();

      scheduler.stop();
    });

    it('warns and skips invalid cron expressions', async () => {
      const configs: ScheduledTaskConfig[] = [
        { name: 'invalid-task', schedule: 'invalid-cron', prompt: 'Invalid', fireOnStart: false },
        { name: 'valid-task', schedule: '* * * * *', prompt: 'Valid', fireOnStart: false },
      ];

      const scheduler = new TaskScheduler(testAgentName, eventRouter, configs, {
        defaultFireOnStart: false,
      });
      await scheduler.start();

      // Both should be in taskCount (system tasks), but only valid one scheduled
      expect(scheduler.taskCount).toBe(2);

      scheduler.stop();
    });

    it('does nothing if already running', async () => {
      const configs: ScheduledTaskConfig[] = [
        { name: 'task', schedule: '* * * * *', prompt: 'Test', fireOnStart: false },
      ];

      const scheduler = new TaskScheduler(testAgentName, eventRouter, configs, {
        defaultFireOnStart: false,
      });
      await scheduler.start();
      await scheduler.start(); // Second start should be ignored

      expect(scheduler.taskCount).toBe(1);

      scheduler.stop();
    });
  });

  describe('stop', () => {
    it('stops all running tasks', async () => {
      const configs: ScheduledTaskConfig[] = [
        { name: 'task-1', schedule: '* * * * *', prompt: 'Test 1', fireOnStart: false },
        { name: 'task-2', schedule: '* * * * *', prompt: 'Test 2', fireOnStart: false },
      ];

      const scheduler = new TaskScheduler(testAgentName, eventRouter, configs, {
        defaultFireOnStart: false,
      });
      await scheduler.start();
      expect(scheduler.running).toBe(true);

      scheduler.stop();

      expect(scheduler.running).toBe(false);
    });

    it('does nothing if not running', () => {
      const scheduler = new TaskScheduler(testAgentName, eventRouter, []);

      // Should not throw
      scheduler.stop();

      expect(scheduler.running).toBe(false);
    });
  });

  describe('agent tasks', () => {
    it('schedules a one-time agent task', async () => {
      const scheduler = new TaskScheduler(testAgentName, eventRouter, []);
      await scheduler.start();

      const futureDate = new Date(Date.now() + 60000).toISOString(); // 1 minute from now
      const task = await scheduler.scheduleAgentTask({
        name: 'Test reminder',
        schedule: futureDate,
        prompt: 'Do the thing',
        recurring: false,
      });

      expect(task.id).toBeDefined();
      expect(task.name).toBe('Test reminder');
      expect(task.schedule).toBe(futureDate);
      expect(task.recurring).toBe(false);
      expect(task.source).toBe('agent');
      expect(task.createdAt).toBeDefined();

      scheduler.stop();
    });

    it('schedules a recurring agent task with cron expression', async () => {
      const scheduler = new TaskScheduler(testAgentName, eventRouter, []);
      await scheduler.start();

      const task = await scheduler.scheduleAgentTask({
        name: 'Check status',
        schedule: '*/15 * * * *',
        prompt: 'Check the status',
        recurring: true,
      });

      expect(task.id).toBeDefined();
      expect(task.schedule).toBe('*/15 * * * *');
      expect(task.recurring).toBe(true);

      scheduler.stop();
    });
  });

  describe('listTasks', () => {
    it('returns all tasks', async () => {
      const configs: ScheduledTaskConfig[] = [
        { name: 'system-task', schedule: '* * * * *', prompt: 'System', fireOnStart: false },
      ];

      const scheduler = new TaskScheduler(testAgentName, eventRouter, configs, {
        defaultFireOnStart: false,
      });
      await scheduler.start();

      await scheduler.scheduleAgentTask({
        name: 'agent-task',
        schedule: new Date(Date.now() + 60000).toISOString(),
        prompt: 'Agent',
      });

      const allTasks = scheduler.listTasks('all');
      expect(allTasks).toHaveLength(2);

      scheduler.stop();
    });

    it('filters by source', async () => {
      const configs: ScheduledTaskConfig[] = [
        { name: 'system-task', schedule: '* * * * *', prompt: 'System', fireOnStart: false },
      ];

      const scheduler = new TaskScheduler(testAgentName, eventRouter, configs, {
        defaultFireOnStart: false,
      });
      await scheduler.start();

      await scheduler.scheduleAgentTask({
        name: 'agent-task',
        schedule: new Date(Date.now() + 60000).toISOString(),
        prompt: 'Agent',
      });

      const systemTasks = scheduler.listTasks('system');
      expect(systemTasks).toHaveLength(1);
      expect(systemTasks[0].name).toBe('system-task');

      const agentTasks = scheduler.listTasks('agent');
      expect(agentTasks).toHaveLength(1);
      expect(agentTasks[0].name).toBe('agent-task');

      scheduler.stop();
    });
  });

  describe('cancelTask', () => {
    it('cancels an agent task', async () => {
      const scheduler = new TaskScheduler(testAgentName, eventRouter, [], {
        defaultFireOnStart: false,
      });
      await scheduler.start();

      const task = await scheduler.scheduleAgentTask({
        name: 'to-cancel',
        schedule: new Date(Date.now() + 60000).toISOString(),
        prompt: 'Cancel me',
      });

      const cancelled = await scheduler.cancelTask(task.id);
      expect(cancelled).toBe(true);
      expect(scheduler.listTasks('agent')).toHaveLength(0);

      scheduler.stop();
    });

    it('cannot cancel system tasks', async () => {
      const configs: ScheduledTaskConfig[] = [
        { name: 'system-task', schedule: '* * * * *', prompt: 'System', fireOnStart: false },
      ];

      const scheduler = new TaskScheduler(testAgentName, eventRouter, configs, {
        defaultFireOnStart: false,
      });
      await scheduler.start();

      const systemTasks = scheduler.listTasks('system');
      const cancelled = await scheduler.cancelTask(systemTasks[0].id);
      expect(cancelled).toBe(false);
      expect(scheduler.listTasks('system')).toHaveLength(1);

      scheduler.stop();
    });

    it('returns false for non-existent task', async () => {
      const scheduler = new TaskScheduler(testAgentName, eventRouter, []);
      await scheduler.start();

      const cancelled = await scheduler.cancelTask('non-existent-id');
      expect(cancelled).toBe(false);

      scheduler.stop();
    });
  });

  describe('persistence', () => {
    it('saves agent tasks to file', async () => {
      const scheduler = new TaskScheduler(testAgentName, eventRouter, []);
      await scheduler.start();

      await scheduler.scheduleAgentTask({
        name: 'persistent-task',
        schedule: new Date(Date.now() + 60000).toISOString(),
        prompt: 'Remember this',
      });

      // Read the file directly
      const filePath = join(testDataDir, `${testAgentName}.json`);
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].name).toBe('persistent-task');

      scheduler.stop();
    });

    it('loads agent tasks from file on start', async () => {
      // Create first scheduler and add task
      const scheduler1 = new TaskScheduler(testAgentName, eventRouter, []);
      await scheduler1.start();

      const futureDate = new Date(Date.now() + 60000).toISOString();
      await scheduler1.scheduleAgentTask({
        name: 'will-persist',
        schedule: futureDate,
        prompt: 'Load me',
      });
      scheduler1.stop();

      // Create new scheduler and verify it loads the task
      const scheduler2 = new TaskScheduler(testAgentName, eventRouter, []);
      await scheduler2.start();

      const tasks = scheduler2.listTasks('agent');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe('will-persist');

      scheduler2.stop();
    });
  });

  describe('event emission', () => {
    it('emits scheduled_task events with correct structure', async () => {
      const configs: ScheduledTaskConfig[] = [
        { name: 'test-task', schedule: '0 0 1 1 *', prompt: 'Test prompt', fireOnStart: true },
      ];

      const scheduler = new TaskScheduler(testAgentName, eventRouter, configs);
      await scheduler.start();
      await flushPromises();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scheduled_task',
          source: 'test-task',
          payload: expect.objectContaining({
            taskName: 'test-task',
            taskSource: 'system',
            prompt: 'Test prompt',
            schedule: '0 0 1 1 *',
            immediate: true,
          }),
          timestamp: expect.any(Date),
        })
      );

      scheduler.stop();
    });
  });

  describe('task firing', () => {
    it('fires handler when one-time task triggers', async () => {
      const scheduler = new TaskScheduler(testAgentName, eventRouter, []);
      await scheduler.start();

      // Schedule task for immediate past (should fire immediately)
      const pastDate = new Date(Date.now() - 1000).toISOString();
      await scheduler.scheduleAgentTask({
        name: 'fire-now',
        schedule: pastDate,
        prompt: 'Fire immediately',
      });

      // Wait a bit for the task to fire
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalled();
      const event = handler.mock.calls[0][0];
      expect(event.type).toBe('scheduled_task');
      expect(event.payload.prompt).toBe('Fire immediately');

      scheduler.stop();
    });

    it('cleans up one-time task after firing', async () => {
      const scheduler = new TaskScheduler(testAgentName, eventRouter, []);
      await scheduler.start();

      const pastDate = new Date(Date.now() - 1000).toISOString();
      await scheduler.scheduleAgentTask({
        name: 'one-time-only',
        schedule: pastDate,
        prompt: 'Fire once',
        recurring: false,
      });

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Task should be removed
      expect(scheduler.listTasks('agent')).toHaveLength(0);

      scheduler.stop();
    });
  });

  describe('createTaskScheduler factory', () => {
    it('creates a configured TaskScheduler', async () => {
      const configs: ScheduledTaskConfig[] = [
        { name: 'factory-task', schedule: '0 0 1 1 *', prompt: 'Factory', fireOnStart: true },
      ];

      const scheduler = createTaskScheduler(testAgentName, eventRouter, configs);

      await scheduler.start();
      await flushPromises();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(scheduler.running).toBe(true);

      scheduler.stop();
    });
  });
});
