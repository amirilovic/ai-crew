import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildPromptFromTrigger,
  buildJournalContext,
  buildCronPrompt,
  buildDiscordPrompt,
  buildReminderPrompt,
  getPromptVariables,
  substituteVariables,
  findCronPrompt,
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
    cronOverrides?: Array<{ schedule: string; task: string; prompt?: string }>
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
    cron: cronOverrides ?? [{ schedule: '*/15 * * * *', task: 'check_board' }],
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

  describe('findCronPrompt', () => {
    it('returns prompt from config when present', () => {
      const config = createMockConfig([
        { schedule: '*/15 * * * *', task: 'check_board', prompt: 'Custom board prompt' },
      ]);
      const prompt = findCronPrompt(config, 'check_board');
      expect(prompt).toBe('Custom board prompt');
    });

    it('returns undefined when task not found', () => {
      const config = createMockConfig();
      const prompt = findCronPrompt(config, 'nonexistent_task');
      expect(prompt).toBeUndefined();
    });

    it('returns undefined when prompt not set', () => {
      const config = createMockConfig([
        { schedule: '*/15 * * * *', task: 'check_board' }, // No prompt field
      ]);
      const prompt = findCronPrompt(config, 'check_board');
      expect(prompt).toBeUndefined();
    });
  });

  describe('buildCronPrompt', () => {
    it('uses custom prompt from config when available', () => {
      const config = createMockConfig([
        { schedule: '*/15 * * * *', task: 'custom_task', prompt: 'Do something on {date}' },
      ]);
      const variables = getPromptVariables('test-agent');
      const prompt = buildCronPrompt(config, 'custom_task', variables);
      expect(prompt).toBe('Do something on 2026-02-21');
    });

    it('falls back to default prompt for check_board', () => {
      const config = createMockConfig();
      const variables = getPromptVariables('test-agent');
      const prompt = buildCronPrompt(config, 'check_board', variables);
      expect(prompt).toContain('Time to check the project board');
      expect(prompt).toContain('Check for failing PRs');
    });

    it('falls back to default prompt for check_mentions', () => {
      const config = createMockConfig();
      const variables = getPromptVariables('test-agent');
      const prompt = buildCronPrompt(config, 'check_mentions', variables);
      expect(prompt).toContain('Time to check Discord channels');
    });

    it('falls back to default prompt for check_reviews', () => {
      const config = createMockConfig();
      const variables = getPromptVariables('test-agent');
      const prompt = buildCronPrompt(config, 'check_reviews', variables);
      expect(prompt).toContain('Time to check for PRs needing code review');
    });

    it('falls back to default prompt for check_prs', () => {
      const config = createMockConfig();
      const variables = getPromptVariables('test-agent');
      const prompt = buildCronPrompt(config, 'check_prs', variables);
      expect(prompt).toContain('Time to check for PRs needing QA testing');
    });

    it('uses generic fallback for unknown tasks', () => {
      const config = createMockConfig();
      const variables = getPromptVariables('test-agent');
      const prompt = buildCronPrompt(config, 'unknown_task', variables);
      expect(prompt).toContain('Scheduled task triggered: unknown_task');
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

  describe('buildReminderPrompt', () => {
    it('includes reminder message and recurring status', () => {
      const event: TriggerEvent = {
        type: 'reminder',
        source: 'reminder-manager',
        payload: {
          message: 'Check the backlog',
          recurring: false,
        },
        timestamp: new Date(),
      };
      const variables = getPromptVariables('test-agent');
      const prompt = buildReminderPrompt(event, variables);
      expect(prompt).toContain('Check the backlog');
      expect(prompt).toContain('one-time');
    });

    it('indicates recurring reminder', () => {
      const event: TriggerEvent = {
        type: 'reminder',
        source: 'reminder-manager',
        payload: {
          message: 'Daily standup',
          recurring: true,
        },
        timestamp: new Date(),
      };
      const variables = getPromptVariables('test-agent');
      const prompt = buildReminderPrompt(event, variables);
      expect(prompt).toContain('Daily standup');
      expect(prompt).toContain('recurring');
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

    it('builds prompt for cron event with config prompt', () => {
      const config = createMockConfig([
        { schedule: '*/5 * * * *', task: 'custom_check', prompt: 'Custom prompt for {date}' },
      ]);
      const event: TriggerEvent = {
        type: 'cron',
        source: 'custom_check',
        payload: {},
        timestamp: new Date(),
      };
      const prompt = buildPromptFromTrigger(event, config);
      expect(prompt).toContain('Custom prompt for 2026-02-21');
    });

    it('builds prompt for cron event with default prompt', () => {
      const config = createMockConfig();
      const event: TriggerEvent = {
        type: 'cron',
        source: 'check_board',
        payload: {},
        timestamp: new Date(),
      };
      const prompt = buildPromptFromTrigger(event, config);
      expect(prompt).toContain('Time to check the project board');
    });

    it('builds prompt for reminder event', () => {
      const config = createMockConfig();
      const event: TriggerEvent = {
        type: 'reminder',
        source: 'reminder-manager',
        payload: { message: 'Follow up', recurring: false },
        timestamp: new Date(),
      };
      const prompt = buildPromptFromTrigger(event, config);
      expect(prompt).toContain('Reminder');
      expect(prompt).toContain('Follow up');
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
