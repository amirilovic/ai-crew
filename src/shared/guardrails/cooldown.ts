import { logger } from '../logger.js';
import type { CooldownEntry } from '../types.js';

export class CooldownManager {
  private cooldowns: Map<string, CooldownEntry> = new Map();
  private defaultCooldownMinutes: number;

  constructor(defaultCooldownMinutes: number = 5) {
    this.defaultCooldownMinutes = defaultCooldownMinutes;
  }

  isOnCooldown(ticketId: string): boolean {
    const entry = this.cooldowns.get(ticketId);
    if (!entry) {
      return false;
    }

    const now = new Date();
    if (now >= entry.cooldownUntil) {
      this.cooldowns.delete(ticketId);
      return false;
    }

    return true;
  }

  getRemainingCooldown(ticketId: string): number {
    const entry = this.cooldowns.get(ticketId);
    if (!entry) {
      return 0;
    }

    const now = new Date();
    const remaining = entry.cooldownUntil.getTime() - now.getTime();
    return Math.max(0, Math.ceil(remaining / 1000));
  }

  startCooldown(ticketId: string, cooldownMinutes?: number): void {
    const minutes = cooldownMinutes ?? this.defaultCooldownMinutes;
    const now = new Date();
    const cooldownUntil = new Date(now.getTime() + minutes * 60 * 1000);

    const entry: CooldownEntry = {
      ticketId,
      lastProcessedAt: now,
      cooldownUntil,
    };

    this.cooldowns.set(ticketId, entry);

    logger.debug('Cooldown started', {
      ticketId,
      cooldownMinutes: minutes,
      cooldownUntil: cooldownUntil.toISOString(),
    });
  }

  clearCooldown(ticketId: string): void {
    this.cooldowns.delete(ticketId);
    logger.debug('Cooldown cleared', { ticketId });
  }

  clearAll(): void {
    this.cooldowns.clear();
    logger.debug('All cooldowns cleared');
  }

  getActiveCooldowns(): CooldownEntry[] {
    const now = new Date();
    const active: CooldownEntry[] = [];

    for (const [ticketId, entry] of this.cooldowns.entries()) {
      if (now < entry.cooldownUntil) {
        active.push(entry);
      } else {
        this.cooldowns.delete(ticketId);
      }
    }

    return active;
  }

  checkAndProcess<T>(ticketId: string, processor: () => T, cooldownMinutes?: number): T | null {
    if (this.isOnCooldown(ticketId)) {
      const remaining = this.getRemainingCooldown(ticketId);
      logger.debug('Ticket on cooldown, skipping', {
        ticketId,
        remainingSeconds: remaining,
      });
      return null;
    }

    const result = processor();
    this.startCooldown(ticketId, cooldownMinutes);
    return result;
  }
}
