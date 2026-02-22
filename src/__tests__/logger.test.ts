/**
 * Tests for logger functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger } from '../shared/logger.js';

describe('Logger', () => {
  beforeEach(() => {
    // Reset environment
    vi.stubEnv('LOG_LEVEL', 'info');
    vi.stubEnv('AGENT_NAME', 'test-agent');
  });

  describe('createLogger', () => {
    it('creates a logger with the specified agent name', () => {
      const logger = createLogger('my-agent');
      expect(logger).toBeDefined();
      expect(logger.defaultMeta).toEqual({ agent: 'my-agent' });
    });

    it('creates a logger with default log level of info', () => {
      vi.stubEnv('LOG_LEVEL', '');
      const logger = createLogger('test');
      expect(logger.level).toBe('info');
    });

    it('respects LOG_LEVEL environment variable', () => {
      vi.stubEnv('LOG_LEVEL', 'debug');
      const logger = createLogger('test');
      expect(logger.level).toBe('debug');
    });

    it('has console and file transports', () => {
      const logger = createLogger('test');
      // Should have 3 transports: console, error file, combined file
      expect(logger.transports.length).toBe(3);
    });
  });

  describe('logging methods', () => {
    it('has standard logging methods available', () => {
      const logger = createLogger('test');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });
  });
});
