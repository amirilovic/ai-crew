import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildPromptFromTrigger,
  buildJournalContext,
  buildScheduledTaskPrompt,
  buildDiscordPrompt,
  getPromptVariables,
  substituteVariables,
} from '../core/runtime/prompt-builder.js';
import type { AgentConfig, TriggerEvent } from '../shared/types.js';

describe('PromptBuilder', () => {
  // Use a fixed date for consistent testing
  const mockDate = new Date('2026-02-21T14:30:00.000Z');
  // Get expected local time string (depends on system timezone)
  const expectedTime = mockDate.toTimeString().split(' ')[0].slice(0, 5);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createMockConfig = (
    scheduledTasks?: Array<{ name: string; schedule: string; prompt: string }>
  ): AgentConfig => ({
    name: 'test-agent',
    displayName: 'Test Agent',
    model: 'claude-sonnet-4-20250514',
    channels: [
      {
        type: 'discord',
        role: 'test',
        primary: 'development',
        canRead: ['development'],
        canWrite: ['development'],
        triggers: { onMention: true, onChannelMessage: false },
      },
    ],
    scheduledTasks: scheduledTasks ?? [
      { name: 'check_board', schedule: '*/15 * * * *', prompt: 'Check the board' },
    ],
    limits: { maxDailyCostUsd: 100, cooldownMinutes: 5 },
    escalatesTo: null,
  });

  describe('getPromptVariables', () => {
    it('returns correct date and time', () => {
      const variables = getPromptVariables('test-agent');
      expect(variables.date).toBe('2026-02-21');
      expect(variables.time).toBe(expectedTime);
      expect(variables.agentName).toBe('test-agent');
      expect(variables.journalPath).toBe('data/journals/test-agent/2026-02-21.md');
    });
  });

  describe('substituteVariables', () => {
    it('substitutes known variables', () => {
      const template = 'Hello {agentName}, today is {date} at {time}';
      const variables = getPromptVariables('my-agent');
      const result = substituteVariables(template, variables);
      expect(result).toBe(`Hello my-agent, today is 2026-02-21 at ${expectedTime}`);
    });

    it('leaves unknown variables unchanged', () => {
      const template = 'Hello {unknown}';
      const variables = getPromptVariables('test');
      const result = substituteVariables(template, variables);
      expect(result).toBe('Hello {unknown}');
    });

    it('handles multiple occurrences of same variable', () => {
      const template = '{date} and again {date}';
      const variables = getPromptVariables('test');
      const result = substituteVariables(template, variables);
      expect(result).toBe('2026-02-21 and again 2026-02-21');
    });
  });

  describe('buildJournalContext', () => {
    it('includes date, time, and journal path', () => {
      const context = buildJournalContext('dev');
      expect(context).toContain('Date: 2026-02-21');
      expect(context).toContain(`Time: ${expectedTime}`);
      expect(context).toContain('data/journals/dev/2026-02-21.md');
      expect(context).toContain('data/shared/');
    });
  });

  describe('buildScheduledTaskPrompt', () => {
    it('uses prompt from event payload', () => {
      const event: TriggerEvent = {
        type: 'scheduled_task',
        source: 'check_board',
        payload: {
          taskId: 'system-check_board',
          taskName: 'check_board',
          taskSource: 'system',
          prompt: 'Check the project board on {date}',
          schedule: '*/15 * * * *',
        },
        timestamp: new Date(),
      };
      const variables = getPromptVariables('test-agent');
      const prompt = buildScheduledTaskPrompt(event, variables);
      expect(prompt).toBe('Check the project board on 2026-02-21');
    });

    it('uses generic fallback when no prompt in payload', () => {
      const event: TriggerEvent = {
        type: 'scheduled_task',
        source: 'unknown_task',
        payload: {
          taskId: 'system-unknown',
          taskName: 'unknown_task',
          taskSource: 'system',
          schedule: '*/15 * * * *',
          // No prompt field
        },
        timestamp: new Date(),
      };
      const variables = getPromptVariables('test-agent');
      const prompt = buildScheduledTaskPrompt(event, variables);
      expect(prompt).toContain('Scheduled task triggered: unknown_task');
    });

    it('substitutes variables in prompt', () => {
      const event: TriggerEvent = {
        type: 'scheduled_task',
        source: 'daily_check',
        payload: {
          taskId: 'system-daily',
          taskName: 'daily_check',
          taskSource: 'system',
          prompt: 'Date: {date}, Time: {time}, Agent: {agentName}',
          schedule: '0 9 * * *',
        },
        timestamp: new Date(),
      };
      const variables = getPromptVariables('my-agent');
      const prompt = buildScheduledTaskPrompt(event, variables);
      expect(prompt).toBe(`Date: 2026-02-21, Time: ${expectedTime}, Agent: my-agent`);
    });
  });

  describe('buildDiscordPrompt', () => {
    it('includes channel, author, and content', () => {
      const event: TriggerEvent = {
        type: 'discord_mention',
        source: 'development',
        payload: {
          author: 'User#1234',
          content: 'Hello agent!',
        },
        timestamp: new Date(),
      };
      const variables = getPromptVariables('test-agent');
      const prompt = buildDiscordPrompt(event, variables);
      expect(prompt).toContain('#development');
      expect(prompt).toContain('User#1234');
      expect(prompt).toContain('Hello agent!');
    });
  });

  describe('buildPromptFromTrigger', () => {
    it('builds prompt for discord_mention event', () => {
      const config = createMockConfig();
      const event: TriggerEvent = {
        type: 'discord_mention',
        source: 'development',
        payload: { author: 'TestUser', content: 'Hey agent!' },
        timestamp: new Date(),
      };
      const prompt = buildPromptFromTrigger(event, config);
      expect(prompt).toContain('Date: 2026-02-21');
      expect(prompt).toContain('TestUser');
      expect(prompt).toContain('Hey agent!');
    });

    it('builds prompt for discord_message event', () => {
      const config = createMockConfig();
      const event: TriggerEvent = {
        type: 'discord_message',
        source: 'discovery',
        payload: { author: 'Colleague', content: 'New discussion' },
        timestamp: new Date(),
      };
      const prompt = buildPromptFromTrigger(event, config);
      expect(prompt).toContain('#discovery');
      expect(prompt).toContain('Colleague');
    });

    it('builds prompt for scheduled_task event', () => {
      const config = createMockConfig();
      const event: TriggerEvent = {
        type: 'scheduled_task',
        source: 'check_board',
        payload: {
          taskId: 'system-check_board',
          taskName: 'check_board',
          taskSource: 'system',
          prompt: 'Time to check the board on {date}',
          schedule: '*/15 * * * *',
        },
        timestamp: new Date(),
      };
      const prompt = buildPromptFromTrigger(event, config);
      expect(prompt).toContain('Time to check the board on 2026-02-21');
    });

    it('handles unknown event types', () => {
      const config = createMockConfig();
      const event: TriggerEvent = {
        type: 'github_pr_comment' as any,
        source: 'github',
        payload: {},
        timestamp: new Date(),
      };
      const prompt = buildPromptFromTrigger(event, config);
      expect(prompt).toContain('Trigger event received');
    });
  });
});
