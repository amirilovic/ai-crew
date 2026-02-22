/**
 * Agent Discovery
 *
 * Dynamically discovers agent roles from config files at startup.
 * Replaces hardcoded role arrays with dynamic discovery.
 */

import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';
import type { AgentConfig, DiscordChannelConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(__dirname, '..', 'agents');

// Cache for discovered roles (populated once at startup)
let cachedAgentRoles: string[] | null = null;

/**
 * Discover all agent Discord roles from config files
 * Results are cached after first call
 */
export async function discoverAgentRoles(): Promise<string[]> {
  if (cachedAgentRoles !== null) {
    return cachedAgentRoles;
  }

  try {
    const agentDirs = await readdir(AGENTS_DIR);
    const roles: string[] = [];

    for (const dir of agentDirs) {
      try {
        const configPath = join(AGENTS_DIR, dir, 'config.json');
        const configContent = await readFile(configPath, 'utf-8');
        const config: AgentConfig = JSON.parse(configContent);

        // Extract Discord role from channels array
        const discordChannel = config.channels.find(
          (c): c is DiscordChannelConfig => c.type === 'discord'
        );

        if (discordChannel?.role) {
          roles.push(discordChannel.role);
        }
      } catch {
        // Skip directories without valid config (e.g., .DS_Store)
        logger.debug('Skipping invalid agent directory', { dir });
      }
    }

    cachedAgentRoles = roles;
    logger.info('Discovered agent roles', { roles });
    return roles;
  } catch (error) {
    logger.error('Failed to discover agent roles', { error });
    // Return empty array as fallback
    return [];
  }
}

/**
 * Get all discovered agent roles
 * Must call discoverAgentRoles() first or this returns empty array
 */
export function getAllAgentRoles(): string[] {
  return cachedAgentRoles ?? [];
}

/**
 * Get other agent roles (excluding the specified role)
 * Used for detecting when another agent is mentioned
 */
export function getOtherAgentRoles(excludeRole: string): string[] {
  const allRoles = getAllAgentRoles();
  return allRoles.filter((role) => role !== excludeRole);
}

/**
 * Clear the cached roles (for testing)
 */
export function clearRoleCache(): void {
  cachedAgentRoles = null;
}

/**
 * Initialize role discovery (call at startup)
 * This is a convenience function that ensures roles are discovered
 */
export async function initializeAgentRoles(): Promise<string[]> {
  return discoverAgentRoles();
}
