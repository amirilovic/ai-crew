/**
 * Discord Adapter Integration Tests
 *
 * Tests the DiscordChannelAdapter using mocked Discord.js client.
 * Focuses on:
 * - Message parsing and conversion
 * - Role mention detection
 * - File/attachment handling
 * - Channel operations (send, read, react)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscordChannelAdapter } from '../core/channels/discord/adapter.js';
import {
  createMockMessage,
  createMockChannel,
  createMockGuild,
  MockCollection,
  type MockChannel,
  type MockGuild,
} from './helpers/discord-mock.js';
import type { ChannelAdapterConfig } from '../core/channels/types.js';

/**
 * Helper to inject mock client into adapter
 * Sets up the internal client state with proper MockCollection for guilds
 */
function injectMockClient(adapter: DiscordChannelAdapter, mockGuild: MockGuild): void {
  const guildsCache = new MockCollection<string, MockGuild>();
  guildsCache.set('guild123', mockGuild);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (adapter as any).client = {
    isReady: () => true,
    user: { id: 'bot123', tag: 'TestBot#0001' },
    guilds: {
      cache: guildsCache,
    },
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    destroy: vi.fn(),
  };
}

/**
 * Helper to get the channel from the guild cache.
 * This ensures we're modifying the same channel object that the adapter will use.
 */
function getChannel(mockGuild: MockGuild): MockChannel {
  const channel = mockGuild.channels.cache.get('channel123');
  if (!channel) throw new Error('Channel not found in mock guild');
  return channel;
}

// Mock discord.js module
vi.mock('discord.js', () => ({
  Client: vi.fn(),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 4,
    GuildMessageReactions: 8,
  },
  ChannelType: {
    GuildText: 0,
  },
  AttachmentBuilder: vi.fn().mockImplementation((path, options) => ({
    attachment: path,
    name: options?.name,
  })),
}));

// Mock environment - return the mock every time
vi.mock('../config/environment.js', () => ({
  getEnv: () => ({
    DISCORD_TOKEN: 'mock-token',
    DISCORD_GUILD_ID: 'guild123',
  }),
}));

// Mock logger
vi.mock('../shared/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock types helper
vi.mock('../shared/types.js', () => ({
  getDiscordConfig: vi.fn().mockReturnValue({
    role: 'dev',
    primary: 'development',
    canRead: ['development', 'general'],
    triggers: {
      onMention: true,
      onChannelMessage: true,
    },
  }),
}));

describe('DiscordChannelAdapter Integration', () => {
  let adapter: DiscordChannelAdapter;
  let mockGuild: MockGuild;
  let config: ChannelAdapterConfig;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock channel with proper structure
    const mockChannel = createMockChannel({
      id: 'channel123',
      name: 'development',
      type: 0,
    });

    // Create mock guild with the channel
    mockGuild = createMockGuild([mockChannel]);

    // Create adapter config
    config = {
      agentConfig: {
        name: 'dev',
        role: 'Developer',
        discord: {
          role: 'dev',
          channels: {
            primary: 'development',
            canRead: ['development', 'general'],
          },
          triggers: {
            onMention: true,
            onChannelMessage: true,
          },
        },
      },
      otherAgentRoles: ['po', 'qa', 'architect'],
    };

    // Create adapter instance
    adapter = new DiscordChannelAdapter(config);

    // Inject the mock client
    injectMockClient(adapter, mockGuild);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Message Parsing', () => {
    it('converts Discord message to ChannelMessage format', async () => {
      const mockMsg = createMockMessage({
        id: 'msg123',
        content: 'Hello world',
        author: {
          id: 'user456',
          tag: 'TestUser#1234',
        },
        createdAt: new Date('2024-06-15T10:30:00Z'),
      });

      const discordMessage = {
        ...mockMsg,
        author: {
          ...mockMsg.author,
          bot: false,
        },
        channel: { id: 'channel123' },
        attachments: new MockCollection(),
        reference: null,
        mentions: {
          roles: new MockCollection<string, { id: string; name: string }>(),
        },
      };

      const channel = getChannel(mockGuild);
      channel.messages.fetch = vi.fn().mockResolvedValue(new Map([['msg123', discordMessage]]));

      const messages = await adapter.readMessages({
        channel: 'development',
        limit: 10,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        id: 'msg123',
        content: 'Hello world',
        channelName: 'development',
        author: {
          id: 'user456',
          name: 'TestUser#1234',
          isBot: false,
        },
      });
    });

    it('handles messages with attachments', async () => {
      // Use MockCollection for attachments (Discord.js uses Collection which has map())
      const attachmentCollection = new MockCollection<
        string,
        { id: string; name: string; url: string; contentType: string; size: number }
      >();
      attachmentCollection.set('att1', {
        id: 'att1',
        name: 'document.pdf',
        url: 'https://cdn.discord.com/attachments/123/document.pdf',
        contentType: 'application/pdf',
        size: 1024,
      });
      attachmentCollection.set('att2', {
        id: 'att2',
        name: 'image.png',
        url: 'https://cdn.discord.com/attachments/123/image.png',
        contentType: 'image/png',
        size: 2048,
      });

      const mockMsg = createMockMessage({
        id: 'msg-with-attachments',
        content: 'Check these files',
        attachments: attachmentCollection,
      });

      const discordMessage = {
        ...mockMsg,
        author: {
          ...mockMsg.author,
          bot: false,
        },
        channel: { id: 'channel123' },
        reference: null,
        mentions: {
          roles: new MockCollection<string, { id: string; name: string }>(),
        },
      };

      const channel = getChannel(mockGuild);
      channel.messages.fetch = vi.fn().mockResolvedValue(new Map([['msg1', discordMessage]]));

      const messages = await adapter.readMessages({
        channel: 'development',
        limit: 10,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].attachments).toHaveLength(2);
      expect(messages[0].attachments[0]).toMatchObject({
        id: 'att1',
        filename: 'document.pdf',
        url: 'https://cdn.discord.com/attachments/123/document.pdf',
        contentType: 'application/pdf',
        size: 1024,
      });
    });

    it('handles messages with reply references', async () => {
      const mockMsg = createMockMessage({
        id: 'reply-msg',
        content: 'This is a reply',
      });

      const discordMessage = {
        ...mockMsg,
        author: {
          ...mockMsg.author,
          bot: false,
        },
        channel: { id: 'channel123' },
        attachments: new MockCollection(),
        reference: {
          messageId: 'original-msg-123',
        },
        mentions: {
          roles: new MockCollection<string, { id: string; name: string }>(),
        },
      };

      const channel = getChannel(mockGuild);
      channel.messages.fetch = vi.fn().mockResolvedValue(new Map([['reply-msg', discordMessage]]));

      const messages = await adapter.readMessages({
        channel: 'development',
        limit: 10,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].replyTo).toBe('original-msg-123');
    });
  });

  describe('Role Mention Detection', () => {
    it('extracts mentioned role names from message', async () => {
      const roleCollection = new MockCollection<string, { id: string; name: string }>();
      roleCollection.set('role-dev', { id: 'role-dev', name: 'dev' });
      roleCollection.set('role-po', { id: 'role-po', name: 'po' });

      const mockMsg = createMockMessage({
        id: 'msg-with-mentions',
        content: 'Hey @dev and @po please review this',
      });

      const discordMessage = {
        ...mockMsg,
        author: {
          ...mockMsg.author,
          bot: false,
        },
        channel: { id: 'channel123' },
        attachments: new MockCollection(),
        reference: null,
        mentions: {
          roles: roleCollection,
        },
      };

      const channel = getChannel(mockGuild);
      channel.messages.fetch = vi.fn().mockResolvedValue(new Map([['msg1', discordMessage]]));

      const messages = await adapter.readMessages({
        channel: 'development',
        limit: 10,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].mentionedRoles).toContain('dev');
      expect(messages[0].mentionedRoles).toContain('po');
    });

    it('returns empty array when no roles mentioned', async () => {
      const mockMsg = createMockMessage({
        id: 'msg-no-mentions',
        content: 'Just a regular message',
      });

      const discordMessage = {
        ...mockMsg,
        author: {
          ...mockMsg.author,
          bot: false,
        },
        channel: { id: 'channel123' },
        attachments: new MockCollection(),
        reference: null,
        mentions: {
          roles: new MockCollection<string, { id: string; name: string }>(),
        },
      };

      const channel = getChannel(mockGuild);
      channel.messages.fetch = vi.fn().mockResolvedValue(new Map([['msg1', discordMessage]]));

      const messages = await adapter.readMessages({
        channel: 'development',
        limit: 10,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].mentionedRoles).toEqual([]);
    });
  });

  describe('Send Message', () => {
    it('sends message to channel successfully', async () => {
      const sentMessage = createMockMessage({
        id: 'sent-msg-123',
        content: 'Test message',
      });

      const channel = getChannel(mockGuild);
      channel.send = vi.fn().mockResolvedValue(sentMessage);

      const result = await adapter.sendMessage({
        channel: 'development',
        content: 'Hello world',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('sent-msg-123');
      expect(channel.send).toHaveBeenCalledWith({
        content: 'Hello world',
      });
    });

    it('converts @rolename to Discord role mentions', async () => {
      const sentMessage = createMockMessage({ id: 'sent-123' });
      const channel = getChannel(mockGuild);
      channel.send = vi.fn().mockResolvedValue(sentMessage);

      // Update guild roles
      const rolesCache = new MockCollection<string, { id: string; name: string }>();
      rolesCache.set('role-dev-id', { id: 'role-dev-id', name: 'dev' });
      rolesCache.set('role-po-id', { id: 'role-po-id', name: 'po' });
      mockGuild.roles.cache = rolesCache;

      await adapter.sendMessage({
        channel: 'development',
        content: 'Hey @dev please check this',
      });

      expect(channel.send).toHaveBeenCalledWith({
        content: 'Hey <@&role-dev-id> please check this',
      });
    });

    it('sends message with reply reference', async () => {
      const sentMessage = createMockMessage({ id: 'reply-123' });
      const channel = getChannel(mockGuild);
      channel.send = vi.fn().mockResolvedValue(sentMessage);

      const result = await adapter.sendMessage({
        channel: 'development',
        content: 'This is a reply',
        replyTo: 'original-msg-456',
      });

      expect(result.success).toBe(true);
      expect(channel.send).toHaveBeenCalledWith({
        content: 'This is a reply',
        reply: { messageReference: 'original-msg-456' },
      });
    });

    it('returns error when channel not found', async () => {
      const result = await adapter.sendMessage({
        channel: 'nonexistent-channel',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('Add Reaction', () => {
    it('adds emoji reaction to message', async () => {
      const mockMsg = createMockMessage({ id: 'msg-to-react' });
      mockMsg.react = vi.fn().mockResolvedValue(undefined);

      const channel = getChannel(mockGuild);
      channel.messages.fetch = vi.fn().mockResolvedValue(mockMsg);

      const result = await adapter.addReaction({
        channel: 'development',
        messageId: 'msg-to-react',
        emoji: '👍',
      });

      expect(result.success).toBe(true);
      expect(mockMsg.react).toHaveBeenCalledWith('👍');
    });

    it('returns error when message not found', async () => {
      const channel = getChannel(mockGuild);
      channel.messages.fetch = vi.fn().mockRejectedValue(new Error('Unknown Message'));

      const result = await adapter.addReaction({
        channel: 'development',
        messageId: 'nonexistent-msg',
        emoji: '👍',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown Message');
    });
  });

  describe('Read Messages', () => {
    it('reads messages with limit', async () => {
      const messages = [
        createMockMessage({ id: 'msg1', content: 'First' }),
        createMockMessage({ id: 'msg2', content: 'Second' }),
        createMockMessage({ id: 'msg3', content: 'Third' }),
      ].map((m) => ({
        ...m,
        author: { ...m.author, bot: false },
        channel: { id: 'channel123' },
        // Use MockCollection for attachments (Discord.js uses Collection which has map())
        attachments: new MockCollection(),
        reference: null,
        mentions: { roles: new MockCollection<string, { id: string; name: string }>() },
      }));

      const messageMap = new Map(messages.map((m) => [m.id, m]));
      const channel = getChannel(mockGuild);
      channel.messages.fetch = vi.fn().mockResolvedValue(messageMap);

      const result = await adapter.readMessages({
        channel: 'development',
        limit: 10,
      });

      expect(result).toHaveLength(3);
      expect(channel.messages.fetch).toHaveBeenCalledWith({ limit: 10 });
    });

    it('reads messages after specific message ID', async () => {
      const messages = [createMockMessage({ id: 'msg-new', content: 'New message' })].map((m) => ({
        ...m,
        author: { ...m.author, bot: false },
        channel: { id: 'channel123' },
        attachments: new MockCollection(),
        reference: null,
        mentions: { roles: new MockCollection<string, { id: string; name: string }>() },
      }));

      const messageMap = new Map(messages.map((m) => [m.id, m]));
      const channel = getChannel(mockGuild);
      channel.messages.fetch = vi.fn().mockResolvedValue(messageMap);

      await adapter.readMessages({
        channel: 'development',
        limit: 50,
        after: 'last-seen-msg-id',
      });

      expect(channel.messages.fetch).toHaveBeenCalledWith({
        limit: 50,
        after: 'last-seen-msg-id',
      });
    });

    it('returns empty array for unknown channel', async () => {
      const result = await adapter.readMessages({
        channel: 'unknown-channel',
        limit: 10,
      });

      expect(result).toEqual([]);
    });
  });

  describe('Fetch Single Message', () => {
    it('fetches a single message by ID', async () => {
      const mockMsg = {
        id: 'specific-msg-123',
        content: 'Specific message',
        author: {
          id: 'user123',
          tag: 'User#0001',
          bot: false,
        },
        channel: { id: 'channel123' },
        createdAt: new Date(),
        attachments: new MockCollection(),
        reference: null,
        mentions: { roles: new MockCollection<string, { id: string; name: string }>() },
      };

      const channel = getChannel(mockGuild);
      channel.messages.fetch = vi.fn().mockResolvedValue(mockMsg);

      const result = await adapter.fetchMessage('development', 'specific-msg-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('specific-msg-123');
      expect(result?.content).toBe('Specific message');
    });

    it('returns null when message not found', async () => {
      const channel = getChannel(mockGuild);
      channel.messages.fetch = vi.fn().mockRejectedValue(new Error('Unknown Message'));

      const result = await adapter.fetchMessage('development', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('Bot Message Detection', () => {
    it('correctly identifies bot messages', async () => {
      const botMessage = {
        ...createMockMessage({
          id: 'bot-msg',
          content: 'Automated message',
        }),
        author: {
          id: 'bot123',
          tag: 'Bot#0001',
          bot: true,
        },
        channel: { id: 'channel123' },
        attachments: new MockCollection(),
        reference: null,
        mentions: { roles: new MockCollection<string, { id: string; name: string }>() },
      };

      const channel = getChannel(mockGuild);
      channel.messages.fetch = vi.fn().mockResolvedValue(new Map([['bot-msg', botMessage]]));

      const messages = await adapter.readMessages({
        channel: 'development',
        limit: 10,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].author.isBot).toBe(true);
    });
  });

  describe('Connection State', () => {
    it('reports not connected initially for new adapter', () => {
      const freshAdapter = new DiscordChannelAdapter(config);
      expect(freshAdapter.isConnected()).toBe(false);
    });

    it('reports connected when client is ready', () => {
      expect(adapter.isConnected()).toBe(true);
    });

    it('returns discord type', () => {
      expect(adapter.type).toBe('discord');
    });
  });
});
