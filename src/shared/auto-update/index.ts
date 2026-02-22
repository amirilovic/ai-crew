/**
 * Auto-Update Service
 *
 * Enables agents to automatically detect and apply updates from main branch.
 * Uses git polling to detect changes and safely applies updates during idle periods.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../logger.js';

const execAsync = promisify(exec);

export interface UpdateResult {
  updated: boolean;
  previousCommit: string | null;
  currentCommit: string;
  error?: string;
}

export interface AutoUpdateConfig {
  enabled: boolean;
  checkIntervalMinutes: number;
  branch: string;
  notifyOnUpdate: boolean;
}

const DEFAULT_CONFIG: AutoUpdateConfig = {
  enabled: true,
  checkIntervalMinutes: 10,
  branch: 'main',
  notifyOnUpdate: true,
};

// Store the last known commit for rollback
let lastKnownCommit: string | null = null;

/**
 * Get the current local HEAD commit hash
 */
export async function getLocalCommit(): Promise<string> {
  try {
    const { stdout } = await execAsync('git rev-parse HEAD');
    return stdout.trim();
  } catch (error) {
    logger.error('Failed to get local commit', { error });
    throw error;
  }
}

/**
 * Get the latest remote commit hash for the specified branch
 */
export async function getRemoteCommit(branch: string = 'main'): Promise<string> {
  try {
    // Fetch latest from remote without merging
    await execAsync('git fetch origin');
    const { stdout } = await execAsync(`git rev-parse origin/${branch}`);
    return stdout.trim();
  } catch (error) {
    logger.error('Failed to get remote commit', { error, branch });
    throw error;
  }
}

/**
 * Check if there are any uncommitted local changes
 */
export async function hasLocalChanges(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('git status --porcelain');
    return stdout.trim().length > 0;
  } catch (error) {
    logger.error('Failed to check local changes', { error });
    throw error;
  }
}

/**
 * Check if an update is available
 */
export async function checkForUpdate(branch: string = 'main'): Promise<{
  updateAvailable: boolean;
  localCommit: string;
  remoteCommit: string;
}> {
  const localCommit = await getLocalCommit();
  const remoteCommit = await getRemoteCommit(branch);

  return {
    updateAvailable: localCommit !== remoteCommit,
    localCommit,
    remoteCommit,
  };
}

/**
 * Pull latest changes from remote
 */
export async function pullLatest(branch: string = 'main'): Promise<UpdateResult> {
  const previousCommit = await getLocalCommit();

  try {
    // Check for local changes first
    if (await hasLocalChanges()) {
      logger.warn('Local changes detected, skipping update');
      return {
        updated: false,
        previousCommit,
        currentCommit: previousCommit,
        error: 'Local changes present - cannot update safely',
      };
    }

    // Store previous commit for potential rollback
    lastKnownCommit = previousCommit;

    // Pull latest
    logger.info('Pulling latest changes', { branch });
    await execAsync(`git pull origin ${branch}`);

    const currentCommit = await getLocalCommit();

    logger.info('Update successful', {
      previousCommit: previousCommit.substring(0, 7),
      currentCommit: currentCommit.substring(0, 7),
    });

    return {
      updated: true,
      previousCommit,
      currentCommit,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to pull latest changes', { error: errorMessage });

    return {
      updated: false,
      previousCommit,
      currentCommit: previousCommit,
      error: errorMessage,
    };
  }
}

/**
 * Rollback to the previous commit if update caused issues
 */
export async function rollback(): Promise<boolean> {
  if (!lastKnownCommit) {
    logger.warn('No previous commit stored for rollback');
    return false;
  }

  try {
    logger.info('Rolling back to previous commit', {
      commit: lastKnownCommit.substring(0, 7),
    });

    await execAsync(`git reset --hard ${lastKnownCommit}`);

    logger.info('Rollback successful');
    return true;
  } catch (error) {
    logger.error('Rollback failed', { error });
    return false;
  }
}

/**
 * Get a summary of what changed between two commits
 */
export async function getChangeSummary(fromCommit: string, toCommit: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`git log --oneline ${fromCommit}..${toCommit}`);
    return stdout.trim().split('\n').filter(Boolean);
  } catch (error) {
    logger.error('Failed to get change summary', { error });
    return [];
  }
}

/**
 * Main update check and apply function
 * Returns update result with details for notification
 */
export async function checkAndApplyUpdate(
  config: Partial<AutoUpdateConfig> = {}
): Promise<UpdateResult & { changes?: string[] }> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  if (!finalConfig.enabled) {
    const currentCommit = await getLocalCommit();
    return {
      updated: false,
      previousCommit: null,
      currentCommit,
      error: 'Auto-update is disabled',
    };
  }

  try {
    // Check if update is available
    const { updateAvailable, localCommit, remoteCommit } = await checkForUpdate(finalConfig.branch);

    if (!updateAvailable) {
      logger.debug('No updates available', {
        currentCommit: localCommit.substring(0, 7),
      });
      return {
        updated: false,
        previousCommit: null,
        currentCommit: localCommit,
      };
    }

    logger.info('Update available', {
      local: localCommit.substring(0, 7),
      remote: remoteCommit.substring(0, 7),
    });

    // Apply update
    const result = await pullLatest(finalConfig.branch);

    // Get change summary if update was successful
    if (result.updated && result.previousCommit) {
      const changes = await getChangeSummary(result.previousCommit, result.currentCommit);
      return { ...result, changes };
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const currentCommit = await getLocalCommit().catch(() => 'unknown');

    return {
      updated: false,
      previousCommit: null,
      currentCommit,
      error: errorMessage,
    };
  }
}

/**
 * Format update result for Discord notification
 */
export function formatUpdateNotification(
  result: UpdateResult & { changes?: string[] },
  agentName: string
): string {
  if (!result.updated) {
    if (result.error) {
      return `⚠️ **@${agentName} update failed**\nError: ${result.error}`;
    }
    return ''; // No notification needed if no update and no error
  }

  const shortPrevious = result.previousCommit?.substring(0, 7) || 'unknown';
  const shortCurrent = result.currentCommit.substring(0, 7);

  let message = `🔄 **@${agentName} updated**\n`;
  message += `\`${shortPrevious}\` → \`${shortCurrent}\``;

  if (result.changes && result.changes.length > 0) {
    message += '\n\n**Changes:**\n';
    // Limit to 5 most recent changes
    const displayChanges = result.changes.slice(0, 5);
    message += displayChanges.map((c) => `• ${c}`).join('\n');
    if (result.changes.length > 5) {
      message += `\n• ... and ${result.changes.length - 5} more`;
    }
  }

  return message;
}
