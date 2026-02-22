import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CostTracker,
  CostLimitExceededError,
  getAllAgentSpend,
} from '../shared/guardrails/cost-tracker.js';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDataDir = join(__dirname, '..', '..', 'test-data', 'spend');

describe('CostTracker', () => {
  let tracker: CostTracker;
  const testAgentName = 'test-cost-agent';

  beforeEach(async () => {
    // Clean up test data directory
    try {
      await rm(testDataDir, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
    await mkdir(testDataDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up after each test
    try {
      await rm(testDataDir, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  describe('trackUsage', () => {
    it('calculates costs correctly for claude-sonnet-4', async () => {
      tracker = new CostTracker({
        maxDailyCostUsd: 10.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      // Claude Sonnet 4: $3/1M input, $15/1M output
      tracker.trackUsage(1_000_000, 0, 'claude-sonnet-4-20250514');
      let stats = tracker.getStats();
      expect(stats.totalCostUsd).toBeCloseTo(3.0, 4);

      tracker.trackUsage(0, 1_000_000, 'claude-sonnet-4-20250514');
      stats = tracker.getStats();
      expect(stats.totalCostUsd).toBeCloseTo(18.0, 4); // 3 + 15
    });

    it('calculates costs correctly for claude-opus-4', async () => {
      tracker = new CostTracker({
        maxDailyCostUsd: 100.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      // Claude Opus 4: $15/1M input, $75/1M output
      tracker.trackUsage(1_000_000, 1_000_000, 'claude-opus-4-20250514');
      const stats = tracker.getStats();
      expect(stats.totalCostUsd).toBeCloseTo(90.0, 4); // 15 + 75
    });

    it('uses default pricing for unknown models', async () => {
      tracker = new CostTracker({
        maxDailyCostUsd: 10.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      // Default: $3/1M input, $15/1M output
      tracker.trackUsage(1_000_000, 1_000_000, 'unknown-model');
      const stats = tracker.getStats();
      expect(stats.totalCostUsd).toBeCloseTo(18.0, 4); // 3 + 15
    });

    it('accumulates costs across multiple calls', async () => {
      tracker = new CostTracker({
        maxDailyCostUsd: 10.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      tracker.trackUsage(100_000, 50_000, 'claude-sonnet-4-20250514');
      tracker.trackUsage(100_000, 50_000, 'claude-sonnet-4-20250514');
      tracker.trackUsage(100_000, 50_000, 'claude-sonnet-4-20250514');

      const stats = tracker.getStats();
      // Each call: (100k/1M)*3 + (50k/1M)*15 = 0.3 + 0.75 = 1.05
      // 3 calls: 3.15
      expect(stats.totalCostUsd).toBeCloseTo(3.15, 4);
      expect(stats.inputTokens).toBe(300_000);
      expect(stats.outputTokens).toBe(150_000);
    });

    it('tracks tokens separately from cost', async () => {
      tracker = new CostTracker({
        maxDailyCostUsd: 10.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      tracker.trackUsage(5000, 2500, 'claude-sonnet-4-20250514');

      const stats = tracker.getStats();
      expect(stats.inputTokens).toBe(5000);
      expect(stats.outputTokens).toBe(2500);
    });
  });

  describe('checkLimit', () => {
    it('does not throw when under limit', async () => {
      tracker = new CostTracker({
        maxDailyCostUsd: 10.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      tracker.trackUsage(100_000, 50_000, 'claude-sonnet-4-20250514');

      expect(() => tracker.checkLimit()).not.toThrow();
    });

    it('throws CostLimitExceededError when limit exceeded', async () => {
      tracker = new CostTracker({
        maxDailyCostUsd: 1.0, // Very low limit
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      // This will exceed $1 limit
      // 1M input tokens = $3 for Sonnet
      tracker.trackUsage(1_000_000, 0, 'claude-sonnet-4-20250514');

      expect(() => tracker.checkLimit()).toThrow(CostLimitExceededError);
      expect(() => tracker.checkLimit()).toThrow(/Daily cost limit of \$1 exceeded/);
    });

    it('canMakeRequest returns false when limit reached', async () => {
      tracker = new CostTracker({
        maxDailyCostUsd: 0.5,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      expect(tracker.canMakeRequest()).toBe(true);

      tracker.trackUsage(1_000_000, 0, 'claude-sonnet-4-20250514'); // $3

      expect(tracker.canMakeRequest()).toBe(false);
    });
  });

  describe('daily reset logic', () => {
    it('resets data when date changes', async () => {
      tracker = new CostTracker({
        maxDailyCostUsd: 10.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      tracker.trackUsage(1_000_000, 0, 'claude-sonnet-4-20250514');
      expect(tracker.getStats().totalCostUsd).toBeCloseTo(3.0, 4);

      // Simulate loading data from a previous day
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      const oldData = {
        date: yesterdayStr,
        inputTokens: 5_000_000,
        outputTokens: 1_000_000,
        totalCostUsd: 30.0,
        warningsEmitted: [50, 75],
      };

      const filePath = join(testDataDir, `${testAgentName}-spend.json`);
      await writeFile(filePath, JSON.stringify(oldData));

      // Create new tracker that will load old data
      const newTracker = new CostTracker({
        maxDailyCostUsd: 10.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      // Should have reset since it's a new day
      const stats = newTracker.getStats();
      expect(stats.totalCostUsd).toBe(0);
      expect(stats.inputTokens).toBe(0);
      expect(stats.outputTokens).toBe(0);
    });

    it('preserves data when same day', async () => {
      const today = new Date().toISOString().split('T')[0];

      const existingData = {
        date: today,
        inputTokens: 100_000,
        outputTokens: 50_000,
        totalCostUsd: 1.05,
        warningsEmitted: [],
      };

      await mkdir(testDataDir, { recursive: true });
      const filePath = join(testDataDir, `${testAgentName}-spend.json`);
      await writeFile(filePath, JSON.stringify(existingData));

      tracker = new CostTracker({
        maxDailyCostUsd: 10.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      const stats = tracker.getStats();
      expect(stats.totalCostUsd).toBeCloseTo(1.05, 4);
      expect(stats.inputTokens).toBe(100_000);
      expect(stats.outputTokens).toBe(50_000);
    });
  });

  describe('persistence', () => {
    it('saves data to file after tracking', async () => {
      tracker = new CostTracker({
        maxDailyCostUsd: 10.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      tracker.trackUsage(100_000, 50_000, 'claude-sonnet-4-20250514');

      const filePath = join(testDataDir, `${testAgentName}-spend.json`);
      const saved = JSON.parse(await readFile(filePath, 'utf-8'));

      expect(saved.inputTokens).toBe(100_000);
      expect(saved.outputTokens).toBe(50_000);
      expect(saved.totalCostUsd).toBeCloseTo(1.05, 4);
      expect(saved.date).toBe(new Date().toISOString().split('T')[0]);
    });

    it('loads existing data on initialization', async () => {
      const today = new Date().toISOString().split('T')[0];
      const existingData = {
        date: today,
        inputTokens: 200_000,
        outputTokens: 100_000,
        totalCostUsd: 2.1,
        warningsEmitted: [],
      };

      const filePath = join(testDataDir, `${testAgentName}-spend.json`);
      await writeFile(filePath, JSON.stringify(existingData));

      tracker = new CostTracker({
        maxDailyCostUsd: 10.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      // Add more usage
      tracker.trackUsage(100_000, 50_000, 'claude-sonnet-4-20250514');

      const stats = tracker.getStats();
      expect(stats.inputTokens).toBe(300_000);
      expect(stats.outputTokens).toBe(150_000);
      expect(stats.totalCostUsd).toBeCloseTo(3.15, 4); // 2.1 + 1.05
    });

    it('archives old data when new day starts', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      const oldData = {
        date: yesterdayStr,
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        totalCostUsd: 10.5,
        warningsEmitted: [50, 75],
      };

      const filePath = join(testDataDir, `${testAgentName}-spend.json`);
      await writeFile(filePath, JSON.stringify(oldData));

      tracker = new CostTracker({
        maxDailyCostUsd: 10.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      // Check archive was created
      const archivePath = join(testDataDir, 'archive', `${testAgentName}-${yesterdayStr}.json`);
      const archived = JSON.parse(await readFile(archivePath, 'utf-8'));

      expect(archived.date).toBe(yesterdayStr);
      expect(archived.totalCostUsd).toBe(10.5);
    });
  });

  describe('threshold warnings', () => {
    it('calls onThresholdWarning when thresholds are crossed', async () => {
      const warningHandler = vi.fn();

      tracker = new CostTracker({
        maxDailyCostUsd: 10.0,
        agentName: testAgentName,
        dataDir: testDataDir,
        onThresholdWarning: warningHandler,
      });

      // 50% threshold: $5
      // 1M input tokens at $3/1M = $3 (30%)
      tracker.trackUsage(1_000_000, 0, 'claude-sonnet-4-20250514');
      expect(warningHandler).not.toHaveBeenCalled();

      // Another 1M input = $6 total (60%) - crosses 50%
      tracker.trackUsage(1_000_000, 0, 'claude-sonnet-4-20250514');
      expect(warningHandler).toHaveBeenCalledWith(
        50,
        expect.objectContaining({
          agentName: testAgentName,
          percentUsed: expect.any(Number),
        })
      );

      // 75% threshold: $7.5
      // Add more to cross 75%
      tracker.trackUsage(500_000, 0, 'claude-sonnet-4-20250514'); // +$1.5 = $7.5
      expect(warningHandler).toHaveBeenCalledWith(75, expect.any(Object));

      // 90% threshold: $9
      tracker.trackUsage(500_000, 0, 'claude-sonnet-4-20250514'); // +$1.5 = $9
      expect(warningHandler).toHaveBeenCalledWith(90, expect.any(Object));
    });

    it('only emits each warning once', async () => {
      const warningHandler = vi.fn();

      tracker = new CostTracker({
        maxDailyCostUsd: 10.0,
        agentName: testAgentName,
        dataDir: testDataDir,
        onThresholdWarning: warningHandler,
      });

      // Cross 50% multiple times
      tracker.trackUsage(2_000_000, 0, 'claude-sonnet-4-20250514'); // $6 (60%)
      tracker.trackUsage(100_000, 0, 'claude-sonnet-4-20250514'); // Still above 50%
      tracker.trackUsage(100_000, 0, 'claude-sonnet-4-20250514'); // Still above 50%

      // 50% warning should only be called once
      const fiftyPercentCalls = warningHandler.mock.calls.filter((call) => call[0] === 50);
      expect(fiftyPercentCalls.length).toBe(1);
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', async () => {
      tracker = new CostTracker({
        maxDailyCostUsd: 10.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      tracker.trackUsage(500_000, 250_000, 'claude-sonnet-4-20250514');
      // Cost: (500k/1M)*3 + (250k/1M)*15 = 1.5 + 3.75 = 5.25

      const stats = tracker.getStats();

      expect(stats.agentName).toBe(testAgentName);
      expect(stats.inputTokens).toBe(500_000);
      expect(stats.outputTokens).toBe(250_000);
      expect(stats.totalCostUsd).toBeCloseTo(5.25, 4);
      expect(stats.maxDailyCostUsd).toBe(10.0);
      expect(stats.remainingBudget).toBeCloseTo(4.75, 4);
      expect(stats.percentUsed).toBeCloseTo(52.5, 1);
      expect(stats.limitReached).toBe(false);
    });

    it('shows limitReached when budget exhausted', async () => {
      tracker = new CostTracker({
        maxDailyCostUsd: 2.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      tracker.trackUsage(1_000_000, 0, 'claude-sonnet-4-20250514'); // $3

      const stats = tracker.getStats();
      expect(stats.limitReached).toBe(true);
      expect(stats.remainingBudget).toBe(0);
    });
  });

  describe('getRemainingBudget', () => {
    it('calculates remaining budget correctly', async () => {
      tracker = new CostTracker({
        maxDailyCostUsd: 10.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      expect(tracker.getRemainingBudget()).toBe(10.0);

      tracker.trackUsage(1_000_000, 0, 'claude-sonnet-4-20250514'); // $3
      expect(tracker.getRemainingBudget()).toBeCloseTo(7.0, 4);

      tracker.trackUsage(0, 200_000, 'claude-sonnet-4-20250514'); // $3
      expect(tracker.getRemainingBudget()).toBeCloseTo(4.0, 4);
    });

    it('never returns negative', async () => {
      tracker = new CostTracker({
        maxDailyCostUsd: 1.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      tracker.trackUsage(1_000_000, 0, 'claude-sonnet-4-20250514'); // $3

      expect(tracker.getRemainingBudget()).toBe(0);
    });
  });

  describe('formatStats', () => {
    it('returns human-readable format', async () => {
      tracker = new CostTracker({
        maxDailyCostUsd: 10.0,
        agentName: testAgentName,
        dataDir: testDataDir,
      });

      tracker.trackUsage(100_000, 50_000, 'claude-sonnet-4-20250514');

      const formatted = tracker.formatStats();

      expect(formatted).toContain(testAgentName);
      expect(formatted).toContain('Spent');
      expect(formatted).toContain('Limit');
      expect(formatted).toContain('Remaining');
      expect(formatted).toContain('Input tokens');
      expect(formatted).toContain('Output tokens');
    });
  });
});

describe('getAllAgentSpend', () => {
  const testDataDir = join(__dirname, '..', '..', 'test-data', 'spend-all');

  beforeEach(async () => {
    try {
      await rm(testDataDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
    await mkdir(testDataDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDataDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('returns stats for all agent spend files', async () => {
    const today = new Date().toISOString().split('T')[0];

    await writeFile(
      join(testDataDir, 'dev-spend.json'),
      JSON.stringify({
        date: today,
        inputTokens: 100,
        outputTokens: 50,
        totalCostUsd: 1.0,
        warningsEmitted: [],
      })
    );
    await writeFile(
      join(testDataDir, 'po-spend.json'),
      JSON.stringify({
        date: today,
        inputTokens: 200,
        outputTokens: 100,
        totalCostUsd: 2.0,
        warningsEmitted: [],
      })
    );

    const stats = getAllAgentSpend(testDataDir);

    expect(stats.length).toBe(2);
    expect(stats.find((s) => s.agentName === 'dev')).toBeDefined();
    expect(stats.find((s) => s.agentName === 'po')).toBeDefined();
  });

  it('returns empty array for non-existent directory', () => {
    const stats = getAllAgentSpend('/nonexistent/path');
    expect(stats).toEqual([]);
  });
});
