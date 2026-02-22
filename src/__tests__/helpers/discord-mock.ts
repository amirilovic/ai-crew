/**
 * Discord.js mock utilities for testing
 *
 * These mocks allow testing Discord tool functions without
 * connecting to a real Discord server.
 */

import { vi } from 'vitest';

// Mock message data
export interface MockMessage {
  id: string;
  content: string;
  author: {
    id: string;
    tag: string;
    bot?: boolean;
  };
  createdAt: Date;
  attachments: Map<string, unknown>;
  react: ReturnType<typeof vi.fn>;
  channel?: { id: string };
  reference?: { messageId?: string } | null;
  mentions?: { roles: Map<string, { id: string; name: string }> };
}

// Mock channel data
export interface MockChannel {
  id: string;
  name: string;
  type: number; // 0 = GuildText
  guild?: MockGuild;
  messages: {
    fetch: ReturnType<typeof vi.fn>;
  };
  send: ReturnType<typeof vi.fn>;
}

/**
 * Discord.js Collection-like Map that supports find method
 * This mimics the Discord.js Collection class
 */
export class MockCollection<K, V> extends Map<K, V> {
  find(predicate: (value: V, key: K, collection: this) => boolean): V | undefined {
    for (const [key, value] of this) {
      if (predicate(value, key, this)) {
        return value;
      }
    }
    return undefined;
  }

  filter(predicate: (value: V, key: K, collection: this) => boolean): MockCollection<K, V> {
    const result = new MockCollection<K, V>();
    for (const [key, value] of this) {
      if (predicate(value, key, this)) {
        result.set(key, value);
      }
    }
    return result;
  }

  map<R>(fn: (value: V, key: K, collection: this) => R): R[] {
    const result: R[] = [];
    for (const [key, value] of this) {
      result.push(fn(value, key, this));
    }
    return result;
  }

  some(predicate: (value: V, key: K, collection: this) => boolean): boolean {
    for (const [key, value] of this) {
      if (predicate(value, key, this)) {
        return true;
      }
    }
    return false;
  }
}

// Mock guild data
export interface MockGuild {
  id: string;
  channels: {
    cache: MockCollection<string, MockChannel>;
  };
  roles: {
    cache: MockCollection<string, { id: string; name: string }>;
  };
}

/**
 * Create a mock Discord message
 */
export function createMockMessage(overrides: Partial<MockMessage> = {}): MockMessage {
  return {
    id: '123456789',
    content: 'Test message content',
    author: {
      id: 'user123',
      tag: 'TestUser#0001',
    },
    createdAt: new Date('2024-01-01T12:00:00Z'),
    attachments: new Map(),
    react: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Create a mock Discord channel
 */
export function createMockChannel(overrides: Partial<MockChannel> = {}): MockChannel {
  const mockMessage = createMockMessage();

  return {
    id: 'channel123',
    name: 'test-channel',
    type: 0, // GuildText
    messages: {
      fetch: vi.fn().mockResolvedValue(new Map([[mockMessage.id, mockMessage]])),
    },
    send: vi.fn().mockResolvedValue(mockMessage),
    ...overrides,
  };
}

/**
 * Create a mock Discord guild
 */
export function createMockGuild(channels: MockChannel[] = []): MockGuild {
  const channelMap = new MockCollection<string, MockChannel>();

  // Add default channel if none provided
  if (channels.length === 0) {
    const defaultChannel = createMockChannel();
    channelMap.set(defaultChannel.id, defaultChannel);
  } else {
    channels.forEach((ch) => {
      channelMap.set(ch.id, ch);
    });
  }

  const rolesCache = new MockCollection<string, { id: string; name: string }>();
  rolesCache.set('role1', { id: 'role1', name: 'dev' });
  rolesCache.set('role2', { id: 'role2', name: 'po' });
  rolesCache.set('role3', { id: 'role3', name: 'reviewer' });

  const guild: MockGuild = {
    id: 'guild123',
    channels: {
      cache: channelMap,
    },
    roles: {
      cache: rolesCache,
    },
  };

  // Set back-reference from channels to guild
  channelMap.forEach((ch) => {
    ch.guild = guild;
  });

  return guild;
}

/**
 * Create a mock Discord client
 */
export function createMockDiscordClient(guild?: MockGuild) {
  const mockGuild = guild || createMockGuild();

  return {
    isReady: vi.fn().mockReturnValue(true),
    user: { tag: 'TestBot#0001' },
    guilds: {
      cache: new Map([['guild123', mockGuild]]),
    },
    once: vi.fn(),
    login: vi.fn().mockResolvedValue('token'),
    destroy: vi.fn(),
  };
}
