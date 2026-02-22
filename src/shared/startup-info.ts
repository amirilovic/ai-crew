/**
 * Startup Information Module
 *
 * Provides agents with self-awareness about when they started and what code
 * version they're running. Useful for debugging and detecting when updates
 * are available.
 */

import { execSync } from 'child_process';
import { logger } from './logger.js';

// Capture startup time when module is loaded
const STARTUP_TIME = new Date();

// Cache git commit hash (computed once at startup)
let cachedCommitHash: string | null = null;

/**
 * Get the timestamp when the agent started
 */
export function getStartupTime(): Date {
  return STARTUP_TIME;
}

/**
 * Get the startup time as ISO string
 */
export function getStartupTimeISO(): string {
  return STARTUP_TIME.toISOString();
}

/**
 * Get the git commit hash that the agent is running
 */
export function getGitCommitHash(): string {
  if (cachedCommitHash !== null) {
    return cachedCommitHash;
  }

  try {
    cachedCommitHash = execSync('git rev-parse HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return cachedCommitHash;
  } catch (error) {
    logger.warn('Failed to get git commit hash', { error });
    cachedCommitHash = 'unknown';
    return cachedCommitHash;
  }
}

/**
 * Get the short (7 char) git commit hash
 */
export function getGitCommitHashShort(): string {
  const fullHash = getGitCommitHash();
  return fullHash === 'unknown' ? 'unknown' : fullHash.substring(0, 7);
}

/**
 * Get the latest commit hash from origin/main
 */
export function getLatestCommitHash(): string {
  try {
    // Fetch latest without changing working directory
    execSync('git fetch origin main --quiet', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return execSync('git rev-parse origin/main', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    logger.warn('Failed to get latest commit hash from origin/main', { error });
    return 'unknown';
  }
}

/**
 * Check if an update is available (current commit differs from origin/main)
 */
export function isUpdateAvailable(): boolean {
  const currentHash = getGitCommitHash();
  const latestHash = getLatestCommitHash();

  if (currentHash === 'unknown' || latestHash === 'unknown') {
    return false; // Can't determine, assume no update
  }

  return currentHash !== latestHash;
}

/**
 * Get comprehensive startup information
 */
export interface StartupInfo {
  startupTime: string;
  startupTimeUnix: number;
  gitCommit: string;
  gitCommitShort: string;
  uptimeSeconds: number;
}

export function getStartupInfo(): StartupInfo {
  const now = new Date();
  return {
    startupTime: getStartupTimeISO(),
    startupTimeUnix: Math.floor(STARTUP_TIME.getTime() / 1000),
    gitCommit: getGitCommitHash(),
    gitCommitShort: getGitCommitHashShort(),
    uptimeSeconds: Math.floor((now.getTime() - STARTUP_TIME.getTime()) / 1000),
  };
}

/**
 * Format startup info for logging or display
 */
export function formatStartupInfo(): string {
  const info = getStartupInfo();
  return `Started at ${info.startupTime} (commit: ${info.gitCommitShort}, uptime: ${info.uptimeSeconds}s)`;
}
