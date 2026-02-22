import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger.js';
import type { CostTrackerData } from '../types.js';

// Pricing per 1M tokens (as of early 2024)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-opus-4-20250514': { input: 15.0, output: 75.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-latest': { input: 3.0, output: 15.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};

const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

// Warning thresholds as percentages of daily limit
const WARNING_THRESHOLDS = [50, 75, 90];

export interface CostTrackerOptions {
  maxDailyCostUsd: number;
  agentName: string;
  dataDir?: string;
  onThresholdWarning?: (threshold: number, stats: CostTrackerStats) => void;
}

export interface CostTrackerStats extends CostTrackerData {
  agentName: string;
  maxDailyCostUsd: number;
  remainingBudget: number;
  percentUsed: number;
  limitReached: boolean;
}

interface PersistedData extends CostTrackerData {
  warningsEmitted: number[]; // thresholds that have already triggered warnings
}

export class CostTracker {
  private data: PersistedData;
  private maxDailyCostUsd: number;
  private agentName: string;
  private dataDir: string;
  private onThresholdWarning?: (threshold: number, stats: CostTrackerStats) => void;

  constructor(options: CostTrackerOptions) {
    this.maxDailyCostUsd = options.maxDailyCostUsd;
    this.agentName = options.agentName;
    this.dataDir = options.dataDir || path.join(process.cwd(), 'data', 'spend');
    this.onThresholdWarning = options.onThresholdWarning;

    // Ensure data directory exists
    this.ensureDataDir();

    // Load persisted data or initialize fresh
    this.data = this.loadData();
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private getDataFilePath(): string {
    return path.join(this.dataDir, `${this.agentName}-spend.json`);
  }

  private loadData(): PersistedData {
    const filePath = this.getDataFilePath();
    const today = new Date().toISOString().split('T')[0];

    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const loaded = JSON.parse(raw) as PersistedData;

        // Check if data is from today
        if (loaded.date === today) {
          logger.info('Loaded persisted spend data', {
            agent: this.agentName,
            date: loaded.date,
            totalCostUsd: loaded.totalCostUsd.toFixed(4),
          });
          return loaded;
        } else {
          // New day, archive old data and start fresh
          logger.info('New day detected, archiving previous spend data', {
            agent: this.agentName,
            previousDate: loaded.date,
            previousCost: loaded.totalCostUsd.toFixed(4),
          });
          this.archiveData(loaded);
        }
      }
    } catch (error) {
      logger.warn('Failed to load spend data, starting fresh', {
        agent: this.agentName,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return this.initializeData();
  }

  private archiveData(data: PersistedData): void {
    try {
      const archiveDir = path.join(this.dataDir, 'archive');
      if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
      }

      const archivePath = path.join(archiveDir, `${this.agentName}-${data.date}.json`);
      fs.writeFileSync(archivePath, JSON.stringify(data, null, 2));

      logger.debug('Archived spend data', {
        agent: this.agentName,
        path: archivePath,
      });
    } catch (error) {
      logger.warn('Failed to archive spend data', {
        agent: this.agentName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private saveData(): void {
    try {
      const filePath = this.getDataFilePath();
      fs.writeFileSync(filePath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      logger.warn('Failed to save spend data', {
        agent: this.agentName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private initializeData(): PersistedData {
    const today = new Date().toISOString().split('T')[0];
    return {
      date: today,
      inputTokens: 0,
      outputTokens: 0,
      totalCostUsd: 0,
      warningsEmitted: [],
    };
  }

  private resetIfNewDay(): void {
    const today = new Date().toISOString().split('T')[0];
    if (this.data.date !== today) {
      logger.info('New day detected, resetting cost tracker', {
        agent: this.agentName,
        previousDate: this.data.date,
        previousCost: this.data.totalCostUsd.toFixed(4),
      });
      this.archiveData(this.data);
      this.data = this.initializeData();
      this.saveData();
    }
  }

  private calculateCost(inputTokens: number, outputTokens: number, model: string): number {
    const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }

  private checkThresholds(): void {
    const percentUsed = (this.data.totalCostUsd / this.maxDailyCostUsd) * 100;

    for (const threshold of WARNING_THRESHOLDS) {
      if (percentUsed >= threshold && !this.data.warningsEmitted.includes(threshold)) {
        this.data.warningsEmitted.push(threshold);

        logger.warn(`Spend threshold reached: ${threshold}%`, {
          agent: this.agentName,
          percentUsed: percentUsed.toFixed(1),
          totalCostUsd: this.data.totalCostUsd.toFixed(4),
          maxDailyCostUsd: this.maxDailyCostUsd,
          remainingBudget: this.getRemainingBudget().toFixed(4),
        });

        if (this.onThresholdWarning) {
          this.onThresholdWarning(threshold, this.getStats());
        }
      }
    }
  }

  trackUsage(inputTokens: number, outputTokens: number, model: string): void {
    this.resetIfNewDay();

    const cost = this.calculateCost(inputTokens, outputTokens, model);

    this.data.inputTokens += inputTokens;
    this.data.outputTokens += outputTokens;
    this.data.totalCostUsd += cost;

    logger.debug('Token usage tracked', {
      agent: this.agentName,
      inputTokens,
      outputTokens,
      cost: cost.toFixed(4),
      dailyTotal: this.data.totalCostUsd.toFixed(4),
    });

    // Check thresholds and save
    this.checkThresholds();
    this.saveData();
  }

  canMakeRequest(): boolean {
    this.resetIfNewDay();
    return this.data.totalCostUsd < this.maxDailyCostUsd;
  }

  getRemainingBudget(): number {
    this.resetIfNewDay();
    return Math.max(0, this.maxDailyCostUsd - this.data.totalCostUsd);
  }

  getStats(): CostTrackerStats {
    this.resetIfNewDay();
    const percentUsed =
      this.maxDailyCostUsd > 0 ? (this.data.totalCostUsd / this.maxDailyCostUsd) * 100 : 0;

    return {
      agentName: this.agentName,
      date: this.data.date,
      inputTokens: this.data.inputTokens,
      outputTokens: this.data.outputTokens,
      totalCostUsd: this.data.totalCostUsd,
      maxDailyCostUsd: this.maxDailyCostUsd,
      remainingBudget: this.getRemainingBudget(),
      percentUsed,
      limitReached: !this.canMakeRequest(),
    };
  }

  checkLimit(): void {
    if (!this.canMakeRequest()) {
      const stats = this.getStats();
      throw new CostLimitExceededError(
        `Daily cost limit of $${this.maxDailyCostUsd} exceeded. ` +
          `Current spend: $${stats.totalCostUsd.toFixed(2)}`
      );
    }
  }

  /**
   * Format stats as a human-readable string
   */
  formatStats(): string {
    const stats = this.getStats();
    const progressBar = this.createProgressBar(stats.percentUsed);

    return [
      `📊 **${stats.agentName}** Spend Report`,
      `Date: ${stats.date}`,
      ``,
      `${progressBar} ${stats.percentUsed.toFixed(1)}%`,
      ``,
      `💰 Spent: $${stats.totalCostUsd.toFixed(4)}`,
      `📈 Limit: $${stats.maxDailyCostUsd.toFixed(2)}`,
      `💵 Remaining: $${stats.remainingBudget.toFixed(4)}`,
      ``,
      `📥 Input tokens: ${stats.inputTokens.toLocaleString()}`,
      `📤 Output tokens: ${stats.outputTokens.toLocaleString()}`,
      stats.limitReached ? `\n⚠️ **LIMIT REACHED** - No more requests allowed today` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private createProgressBar(percent: number): string {
    const width = 20;
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);

    // Color indicator based on usage
    if (percent >= 90) return `🔴 [${bar}]`;
    if (percent >= 75) return `🟠 [${bar}]`;
    if (percent >= 50) return `🟡 [${bar}]`;
    return `🟢 [${bar}]`;
  }
}

export class CostLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CostLimitExceededError';
  }
}

/**
 * Get spend stats for all agents
 */
export function getAllAgentSpend(dataDir?: string): CostTrackerStats[] {
  const dir = dataDir || path.join(process.cwd(), 'data', 'spend');
  const stats: CostTrackerStats[] = [];

  try {
    if (!fs.existsSync(dir)) {
      return stats;
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('-spend.json'));

    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw) as PersistedData & { agentName?: string };

        // Extract agent name from filename
        const agentName = file.replace('-spend.json', '');

        stats.push({
          agentName,
          date: data.date,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          totalCostUsd: data.totalCostUsd,
          maxDailyCostUsd: 0, // Unknown without config
          remainingBudget: 0,
          percentUsed: 0,
          limitReached: false,
        });
      } catch {
        // Skip invalid files
      }
    }
  } catch {
    // Return empty array on error
  }

  return stats;
}
