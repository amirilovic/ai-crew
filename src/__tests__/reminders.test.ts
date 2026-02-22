import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReminderManager } from '../shared/reminders/index.js';
import { rm, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDataDir = join(__dirname, '..', '..', 'data', 'reminders');

describe('ReminderManager', () => {
  let manager: ReminderManager;
  const testAgentName = 'test-agent';

  beforeEach(async () => {
    // Clean up test data
    try {
      await rm(join(testDataDir, `${testAgentName}.json`), { force: true });
    } catch {
      // Ignore if doesn't exist
    }
    manager = new ReminderManager(testAgentName);
  });

  afterEach(() => {
    manager.stop();
  });

  describe('scheduleReminder', () => {
    it('creates a one-time reminder', async () => {
      await manager.start();

      const futureDate = new Date(Date.now() + 60000).toISOString(); // 1 minute from now
      const reminder = await manager.scheduleReminder({
        message: 'Test reminder',
        when: futureDate,
        recurring: false,
      });

      expect(reminder.id).toBeDefined();
      expect(reminder.message).toBe('Test reminder');
      expect(reminder.when).toBe(futureDate);
      expect(reminder.recurring).toBe(false);
      expect(reminder.createdAt).toBeDefined();
    });

    it('creates a recurring reminder with cron expression', async () => {
      await manager.start();

      const reminder = await manager.scheduleReminder({
        message: 'Check status',
        when: '*/15 * * * *', // every 15 minutes
        recurring: true,
      });

      expect(reminder.id).toBeDefined();
      expect(reminder.message).toBe('Check status');
      expect(reminder.when).toBe('*/15 * * * *');
      expect(reminder.recurring).toBe(true);
    });
  });

  describe('listReminders', () => {
    it('returns all reminders', async () => {
      await manager.start();

      await manager.scheduleReminder({
        message: 'Reminder 1',
        when: new Date(Date.now() + 60000).toISOString(),
      });
      await manager.scheduleReminder({
        message: 'Reminder 2',
        when: '0 9 * * *',
        recurring: true,
      });

      const reminders = manager.listReminders();
      expect(reminders).toHaveLength(2);
      expect(reminders[0].message).toBe('Reminder 1');
      expect(reminders[1].message).toBe('Reminder 2');
    });

    it('returns empty array when no reminders', async () => {
      await manager.start();
      const reminders = manager.listReminders();
      expect(reminders).toEqual([]);
    });
  });

  describe('cancelReminder', () => {
    it('cancels an existing reminder', async () => {
      await manager.start();

      const reminder = await manager.scheduleReminder({
        message: 'To be cancelled',
        when: new Date(Date.now() + 60000).toISOString(),
      });

      const cancelled = await manager.cancelReminder(reminder.id);
      expect(cancelled).toBe(true);
      expect(manager.listReminders()).toHaveLength(0);
    });

    it('returns false for non-existent reminder', async () => {
      await manager.start();
      const cancelled = await manager.cancelReminder('non-existent-id');
      expect(cancelled).toBe(false);
    });
  });

  describe('persistence', () => {
    it('saves reminders to file', async () => {
      await manager.start();

      await manager.scheduleReminder({
        message: 'Persistent reminder',
        when: new Date(Date.now() + 60000).toISOString(),
      });

      // Read the file directly
      const filePath = join(testDataDir, `${testAgentName}.json`);
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      expect(data.reminders).toHaveLength(1);
      expect(data.reminders[0].message).toBe('Persistent reminder');
    });

    it('loads reminders from file on start', async () => {
      // Create first manager and add reminder
      await manager.start();
      const futureDate = new Date(Date.now() + 60000).toISOString();
      await manager.scheduleReminder({
        message: 'Will persist',
        when: futureDate,
      });
      manager.stop();

      // Create new manager and verify it loads the reminder
      const manager2 = new ReminderManager(testAgentName);
      await manager2.start();

      const reminders = manager2.listReminders();
      expect(reminders).toHaveLength(1);
      expect(reminders[0].message).toBe('Will persist');

      manager2.stop();
    });
  });

  describe('reminder firing', () => {
    it('fires handler when reminder triggers', async () => {
      const handler = vi.fn();
      manager.setHandler(handler);
      await manager.start();

      // Schedule reminder for immediate past (should fire immediately)
      const pastDate = new Date(Date.now() - 1000).toISOString();
      await manager.scheduleReminder({
        message: 'Fire now',
        when: pastDate,
      });

      // Wait a bit for the reminder to fire
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalled();
      const event = handler.mock.calls[0][0];
      expect(event.type).toBe('reminder');
      expect(event.payload.message).toBe('Fire now');
    });

    it('cleans up one-time reminder after firing', async () => {
      const handler = vi.fn();
      manager.setHandler(handler);
      await manager.start();

      const pastDate = new Date(Date.now() - 1000).toISOString();
      await manager.scheduleReminder({
        message: 'One time only',
        when: pastDate,
        recurring: false,
      });

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Reminder should be removed
      expect(manager.listReminders()).toHaveLength(0);
    });
  });
});
