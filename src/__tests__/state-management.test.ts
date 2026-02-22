import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { loadState, saveState } from '../shared/runner/triggers.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

// Mock logger
vi.mock('../shared/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('State Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadState', () => {
    it('returns empty state when no file exists', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

      const state = await loadState('test-agent');

      expect(state).toEqual({});
    });

    it('loads per-channel tracking format correctly', async () => {
      const savedState = {
        lastProcessedMessageIds: {
          development: '123456789',
          discovery: '987654321',
        },
        sessionId: 'session-123',
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(savedState));

      const state = await loadState('test-agent');

      expect(state.lastProcessedMessageIds).toEqual({
        development: '123456789',
        discovery: '987654321',
      });
      expect(state.sessionId).toBe('session-123');
    });

    it('migrates from legacy global lastProcessedMessageId format', async () => {
      const legacyState = {
        lastProcessedMessageId: '123456789', // Old format
        sessionId: 'session-123',
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(legacyState));

      const state = await loadState('test-agent');

      // Should have empty per-channel tracking (will be initialized on first message)
      expect(state.lastProcessedMessageIds).toEqual({});
      expect(state.sessionId).toBe('session-123');
      // Legacy field should NOT be in the returned state
      expect(state.lastProcessedMessageId).toBeUndefined();
    });
  });

  describe('saveState', () => {
    it('saves state in per-channel format', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const state = {
        lastProcessedMessageIds: {
          development: '123456789',
          discovery: '987654321',
        },
        sessionId: 'session-123',
      };

      await saveState('test-agent', state);

      expect(writeFile).toHaveBeenCalledTimes(1);
      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
      const parsedContent = JSON.parse(writtenContent);

      expect(parsedContent.lastProcessedMessageIds).toEqual({
        development: '123456789',
        discovery: '987654321',
      });
      expect(parsedContent.sessionId).toBe('session-123');
      // Should NOT include legacy format
      expect(parsedContent.lastProcessedMessageId).toBeUndefined();
    });

    it('does not save legacy lastProcessedMessageId even if present in state', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const state = {
        lastProcessedMessageIds: { development: '123' },
        lastProcessedMessageId: '999', // Legacy field - should be ignored
        sessionId: 'session-123',
      };

      await saveState('test-agent', state);

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
      const parsedContent = JSON.parse(writtenContent);

      // Legacy field should NOT be saved
      expect(parsedContent.lastProcessedMessageId).toBeUndefined();
      expect(parsedContent.lastProcessedMessageIds).toEqual({ development: '123' });
    });
  });

  describe('migration flow', () => {
    it('correctly handles full migration cycle', async () => {
      // Step 1: Load legacy state
      const legacyState = {
        lastProcessedMessageId: 'old-global-id',
        sessionId: 'session-123',
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(legacyState));

      const loadedState = await loadState('test-agent');

      // After loading, per-channel tracking is initialized as empty
      expect(loadedState.lastProcessedMessageIds).toEqual({});
      expect(loadedState.lastProcessedMessageId).toBeUndefined();

      // Step 2: Simulate processing messages and updating state
      loadedState.lastProcessedMessageIds = {
        development: 'new-dev-id',
        discovery: 'new-disc-id',
      };

      // Step 3: Save state
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await saveState('test-agent', loadedState);

      const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
      const parsedContent = JSON.parse(writtenContent);

      // Saved state should only have new format
      expect(parsedContent.lastProcessedMessageIds).toEqual({
        development: 'new-dev-id',
        discovery: 'new-disc-id',
      });
      expect(parsedContent.lastProcessedMessageId).toBeUndefined();
    });
  });
});
