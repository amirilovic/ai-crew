/**
 * Tests for startup information module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock execSync before importing the module
vi.mock('child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd === 'git rev-parse HEAD') {
      return 'abc123def456789abcdef1234567890abcdef12\n';
    }
    if (cmd === 'git rev-parse origin/main') {
      return 'abc123def456789abcdef1234567890abcdef12\n';
    }
    if (cmd.includes('git fetch')) {
      return '';
    }
    throw new Error(`Unknown command: ${cmd}`);
  }),
}));

describe('Startup Info', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getStartupTime', () => {
    it('returns a Date object', async () => {
      const { getStartupTime } = await import('../shared/startup-info.js');
      const startupTime = getStartupTime();
      expect(startupTime).toBeInstanceOf(Date);
    });

    it('returns consistent value across multiple calls', async () => {
      const { getStartupTime } = await import('../shared/startup-info.js');
      const time1 = getStartupTime();
      const time2 = getStartupTime();
      expect(time1.getTime()).toBe(time2.getTime());
    });
  });

  describe('getStartupTimeISO', () => {
    it('returns an ISO string', async () => {
      const { getStartupTimeISO } = await import('../shared/startup-info.js');
      const isoString = getStartupTimeISO();
      expect(isoString).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('getGitCommitHash', () => {
    it('returns commit hash from git', async () => {
      const { getGitCommitHash } = await import('../shared/startup-info.js');
      const hash = getGitCommitHash();
      expect(hash).toBe('abc123def456789abcdef1234567890abcdef12');
    });
  });

  describe('getGitCommitHashShort', () => {
    it('returns first 7 characters of commit hash', async () => {
      const { getGitCommitHashShort } = await import('../shared/startup-info.js');
      const shortHash = getGitCommitHashShort();
      expect(shortHash).toBe('abc123d');
      expect(shortHash.length).toBe(7);
    });
  });

  describe('getStartupInfo', () => {
    it('returns comprehensive startup information', async () => {
      const { getStartupInfo } = await import('../shared/startup-info.js');
      const info = getStartupInfo();

      expect(info).toMatchObject({
        startupTime: expect.any(String),
        startupTimeUnix: expect.any(Number),
        gitCommit: expect.any(String),
        gitCommitShort: expect.any(String),
        uptimeSeconds: expect.any(Number),
      });
    });

    it('has non-negative uptime', async () => {
      const { getStartupInfo } = await import('../shared/startup-info.js');
      const info = getStartupInfo();
      expect(info.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('short commit is prefix of full commit', async () => {
      const { getStartupInfo } = await import('../shared/startup-info.js');
      const info = getStartupInfo();
      expect(info.gitCommit.startsWith(info.gitCommitShort)).toBe(true);
    });
  });

  describe('formatStartupInfo', () => {
    it('returns human-readable string', async () => {
      const { formatStartupInfo } = await import('../shared/startup-info.js');
      const formatted = formatStartupInfo();

      expect(formatted).toContain('Started at');
      expect(formatted).toContain('commit:');
      expect(formatted).toContain('uptime:');
    });
  });

  describe('isUpdateAvailable', () => {
    it('returns false when current matches origin/main', async () => {
      const { isUpdateAvailable } = await import('../shared/startup-info.js');
      // Mock returns same hash for both, so no update available
      const updateAvailable = isUpdateAvailable();
      expect(updateAvailable).toBe(false);
    });
  });
});
