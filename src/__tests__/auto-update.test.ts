/**
 * Tests for auto-update service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exec } from 'child_process';

// Mock child_process.exec
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// Import after mocking
const _mockExec = vi.mocked(exec);

// Helper to create mock exec implementation
function _mockExecResult(stdout: string, stderr: string = '') {
  return vi.fn(
    (
      _cmd: string,
      callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
      callback(null, { stdout, stderr });
    }
  );
}

describe('Auto-Update Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('formatUpdateNotification', () => {
    it('formats update notification correctly', async () => {
      // Import dynamically to avoid import errors with mocked modules
      const { formatUpdateNotification } = await import('../shared/auto-update/index.js');

      const result = {
        updated: true,
        previousCommit: 'abc1234567890',
        currentCommit: 'def5678901234',
        changes: ['abc1234 feat: Add new feature', 'bcd2345 fix: Bug fix'],
      };

      const notification = formatUpdateNotification(result, 'dev');

      expect(notification).toContain('@dev updated');
      expect(notification).toContain('abc1234');
      expect(notification).toContain('def5678');
      expect(notification).toContain('feat: Add new feature');
    });

    it('returns empty string when no update', async () => {
      const { formatUpdateNotification } = await import('../shared/auto-update/index.js');

      const result = {
        updated: false,
        previousCommit: null,
        currentCommit: 'abc1234567890',
      };

      const notification = formatUpdateNotification(result, 'dev');
      expect(notification).toBe('');
    });

    it('formats error notification', async () => {
      const { formatUpdateNotification } = await import('../shared/auto-update/index.js');

      const result = {
        updated: false,
        previousCommit: null,
        currentCommit: 'abc1234567890',
        error: 'Local changes present',
      };

      const notification = formatUpdateNotification(result, 'po');
      expect(notification).toContain('@po update failed');
      expect(notification).toContain('Local changes present');
    });

    it('limits changes to 5 entries', async () => {
      const { formatUpdateNotification } = await import('../shared/auto-update/index.js');

      const result = {
        updated: true,
        previousCommit: 'abc1234567890',
        currentCommit: 'def5678901234',
        changes: [
          'change1',
          'change2',
          'change3',
          'change4',
          'change5',
          'change6',
          'change7',
          'change8',
        ],
      };

      const notification = formatUpdateNotification(result, 'reviewer');
      expect(notification).toContain('change1');
      expect(notification).toContain('change5');
      expect(notification).not.toContain('change6');
      expect(notification).toContain('and 3 more');
    });
  });
});
