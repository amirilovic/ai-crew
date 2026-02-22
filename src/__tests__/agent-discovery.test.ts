import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  discoverAgentRoles,
  getAllAgentRoles,
  getOtherAgentRoles,
  clearRoleCache,
} from '../shared/agent-discovery.js';

describe('AgentDiscovery', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearRoleCache();
  });

  afterEach(() => {
    clearRoleCache();
  });

  describe('discoverAgentRoles', () => {
    it('discovers roles from agent config files', async () => {
      const roles = await discoverAgentRoles();

      // Should discover roles from all agent configs
      expect(roles).toContain('dev');
      expect(roles).toContain('po');
      expect(roles).toContain('qa');
      expect(roles).toContain('architect');
    });

    it('does not include stale roles', async () => {
      const roles = await discoverAgentRoles();

      // These were hardcoded before but should not be discovered
      expect(roles).not.toContain('sre');
      expect(roles).not.toContain('reviewer');
    });

    it('caches results after first call', async () => {
      const roles1 = await discoverAgentRoles();
      const roles2 = await discoverAgentRoles();

      // Should return same array reference (cached)
      expect(roles1).toBe(roles2);
    });

    it('returns exactly 4 roles for current agent setup', async () => {
      const roles = await discoverAgentRoles();

      // Current agents: dev, po, qa, architect
      expect(roles).toHaveLength(4);
    });
  });

  describe('getAllAgentRoles', () => {
    it('returns empty array before discovery', () => {
      const roles = getAllAgentRoles();
      expect(roles).toEqual([]);
    });

    it('returns cached roles after discovery', async () => {
      await discoverAgentRoles();
      const roles = getAllAgentRoles();

      expect(roles).toContain('dev');
      expect(roles).toContain('po');
      expect(roles).toContain('qa');
      expect(roles).toContain('architect');
    });
  });

  describe('getOtherAgentRoles', () => {
    beforeEach(async () => {
      await discoverAgentRoles();
    });

    it('excludes the specified role', () => {
      const otherRoles = getOtherAgentRoles('dev');

      expect(otherRoles).not.toContain('dev');
      expect(otherRoles).toContain('po');
      expect(otherRoles).toContain('qa');
      expect(otherRoles).toContain('architect');
    });

    it('returns all roles if excludeRole not found', () => {
      const otherRoles = getOtherAgentRoles('nonexistent');

      expect(otherRoles).toContain('dev');
      expect(otherRoles).toContain('po');
      expect(otherRoles).toContain('qa');
      expect(otherRoles).toContain('architect');
    });

    it('returns 3 roles when excluding one', () => {
      const otherRoles = getOtherAgentRoles('qa');
      expect(otherRoles).toHaveLength(3);
    });
  });

  describe('clearRoleCache', () => {
    it('clears the cached roles', async () => {
      await discoverAgentRoles();
      expect(getAllAgentRoles().length).toBeGreaterThan(0);

      clearRoleCache();
      expect(getAllAgentRoles()).toEqual([]);
    });
  });
});
