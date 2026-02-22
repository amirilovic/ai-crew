import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to test the environment module which reads process.env
// So we'll test the validation logic by importing the module and mocking process.env

describe('Environment Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules to clear cached env
    vi.resetModules();
    // Create a fresh copy of process.env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('envSchema validation', () => {
    it('accepts valid minimal config', async () => {
      process.env.DISCORD_GUILD_ID = '123456789';

      const { loadEnvironment } = await import('../config/environment.js');
      const env = loadEnvironment();

      expect(env.DISCORD_GUILD_ID).toBe('123456789');
      expect(env.LOG_LEVEL).toBe('info'); // default
      expect(env.MAX_DAILY_COST_USD).toBe(50); // default
    });

    it('accepts valid full config', async () => {
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.DISCORD_TOKEN = 'test-token';
      process.env.MAX_DAILY_COST_USD = '100';
      process.env.AGENT_NAME = 'test-agent';
      process.env.LOG_LEVEL = 'debug';
      process.env.OPENAI_API_KEY = 'sk-test';

      const { loadEnvironment } = await import('../config/environment.js');
      const env = loadEnvironment();

      expect(env.DISCORD_GUILD_ID).toBe('123456789');
      expect(env.DISCORD_TOKEN).toBe('test-token');
      expect(env.MAX_DAILY_COST_USD).toBe(100);
      expect(env.AGENT_NAME).toBe('test-agent');
      expect(env.LOG_LEVEL).toBe('debug');
      expect(env.OPENAI_API_KEY).toBe('sk-test');
    });

    it('throws helpful error when DISCORD_GUILD_ID is missing', async () => {
      delete process.env.DISCORD_GUILD_ID;

      const { loadEnvironment } = await import('../config/environment.js');

      expect(() => loadEnvironment()).toThrow('Environment validation failed');
      expect(() => loadEnvironment()).toThrow('DISCORD_GUILD_ID');
    });

    it('throws helpful error when DISCORD_GUILD_ID is empty', async () => {
      process.env.DISCORD_GUILD_ID = '';

      const { loadEnvironment } = await import('../config/environment.js');

      expect(() => loadEnvironment()).toThrow('Environment validation failed');
      expect(() => loadEnvironment()).toThrow('DISCORD_GUILD_ID is required');
    });

    it('throws error for invalid LOG_LEVEL', async () => {
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.LOG_LEVEL = 'invalid';

      const { loadEnvironment } = await import('../config/environment.js');

      expect(() => loadEnvironment()).toThrow('Environment validation failed');
      expect(() => loadEnvironment()).toThrow('LOG_LEVEL');
    });

    it('validates LOG_LEVEL enum values', async () => {
      const validLevels = ['error', 'warn', 'info', 'debug'];

      for (const level of validLevels) {
        vi.resetModules();
        process.env = { ...originalEnv };
        process.env.DISCORD_GUILD_ID = '123456789';
        process.env.LOG_LEVEL = level;

        const { loadEnvironment } = await import('../config/environment.js');
        const env = loadEnvironment();

        expect(env.LOG_LEVEL).toBe(level);
      }
    });

    it('transforms MAX_DAILY_COST_USD to number', async () => {
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.MAX_DAILY_COST_USD = '25.50';

      const { loadEnvironment } = await import('../config/environment.js');
      const env = loadEnvironment();

      expect(env.MAX_DAILY_COST_USD).toBe(25.5);
      expect(typeof env.MAX_DAILY_COST_USD).toBe('number');
    });

    it('uses default MAX_DAILY_COST_USD when not provided', async () => {
      process.env.DISCORD_GUILD_ID = '123456789';
      delete process.env.MAX_DAILY_COST_USD;

      const { loadEnvironment } = await import('../config/environment.js');
      const env = loadEnvironment();

      expect(env.MAX_DAILY_COST_USD).toBe(50);
    });

    it('optional fields are truly optional', async () => {
      process.env.DISCORD_GUILD_ID = '123456789';
      // Explicitly delete optional fields
      delete process.env.DISCORD_TOKEN;
      delete process.env.AGENT_NAME;
      delete process.env.OPENAI_API_KEY;

      const { loadEnvironment } = await import('../config/environment.js');
      const env = loadEnvironment();

      expect(env.DISCORD_TOKEN).toBeUndefined();
      expect(env.AGENT_NAME).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBeUndefined();
    });
  });

  describe('getEnv', () => {
    it('returns cached environment on subsequent calls', async () => {
      process.env.DISCORD_GUILD_ID = '123456789';

      const { getEnv, loadEnvironment } = await import('../config/environment.js');

      // First call loads
      loadEnvironment();

      // Change env var
      process.env.DISCORD_GUILD_ID = '987654321';

      // Second call should return cached value
      const env2 = getEnv();

      expect(env2.DISCORD_GUILD_ID).toBe('123456789'); // Original value
    });

    it('loads environment if not cached', async () => {
      process.env.DISCORD_GUILD_ID = '123456789';

      const { getEnv } = await import('../config/environment.js');
      const env = getEnv();

      expect(env.DISCORD_GUILD_ID).toBe('123456789');
    });
  });

  describe('error messages', () => {
    it('shows all validation errors at once', async () => {
      // Missing required field and invalid enum
      delete process.env.DISCORD_GUILD_ID;
      process.env.LOG_LEVEL = 'invalid';

      const { loadEnvironment } = await import('../config/environment.js');

      try {
        loadEnvironment();
        expect.fail('Should have thrown');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('DISCORD_GUILD_ID');
        expect(message).toContain('LOG_LEVEL');
      }
    });

    it('formats error messages with field paths', async () => {
      delete process.env.DISCORD_GUILD_ID;

      const { loadEnvironment } = await import('../config/environment.js');

      try {
        loadEnvironment();
        expect.fail('Should have thrown');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('Environment validation failed:');
        expect(message).toContain('  - '); // Bullet point format
      }
    });
  });
});
