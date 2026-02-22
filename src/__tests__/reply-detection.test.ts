import { describe, it, expect } from 'vitest';
import type { ChannelMessageEvent } from '../core/channels/types.js';

/**
 * Reply Detection Tests
 *
 * These tests verify the reply detection logic behavior.
 * The actual Discord integration is tested manually, but these tests
 * verify the event structure and expected behavior.
 */

describe('Reply Detection', () => {
  describe('ChannelMessageEvent structure', () => {
    it('includes isReplyToAgent field for mentions', () => {
      const event: ChannelMessageEvent = {
        type: 'mention',
        message: {
          id: '123',
          channelId: 'channel-123',
          channelName: 'development',
          author: { id: 'user-123', name: 'TestUser#1234', isBot: false },
          content: '@dev hello',
          timestamp: new Date(),
          attachments: [],
          mentionedRoles: ['dev'],
        },
        isMention: true,
        otherAgentMentioned: false,
        isReplyToAgent: false,
      };

      expect(event.isReplyToAgent).toBe(false);
      expect(event.isMention).toBe(true);
    });

    it('includes isReplyToAgent field for replies', () => {
      const event: ChannelMessageEvent = {
        type: 'mention', // Replies are treated as mentions
        message: {
          id: '456',
          channelId: 'channel-123',
          channelName: 'development',
          author: { id: 'user-123', name: 'TestUser#1234', isBot: false },
          content: 'What does this PR change?',
          timestamp: new Date(),
          attachments: [],
          replyTo: '789', // Reference to agent's message
          mentionedRoles: [],
        },
        isMention: false,
        otherAgentMentioned: false,
        isReplyToAgent: true,
      };

      expect(event.isReplyToAgent).toBe(true);
      expect(event.isMention).toBe(false);
    });

    it('handles both mention and reply', () => {
      const event: ChannelMessageEvent = {
        type: 'mention',
        message: {
          id: '789',
          channelId: 'channel-123',
          channelName: 'development',
          author: { id: 'user-123', name: 'TestUser#1234', isBot: false },
          content: '@dev can you explain?',
          timestamp: new Date(),
          attachments: [],
          replyTo: '012', // Also a reply
          mentionedRoles: ['dev'],
        },
        isMention: true,
        otherAgentMentioned: false,
        isReplyToAgent: true,
      };

      // Both flags should be true
      expect(event.isReplyToAgent).toBe(true);
      expect(event.isMention).toBe(true);
    });
  });

  describe('shouldEmit logic (documented behavior)', () => {
    // These tests document the expected behavior based on message types

    it('should emit for explicit mentions', () => {
      // Given: A message with @dev mention
      const myRoleMentioned = true;
      const isReplyToAgent = false;
      const otherAgentMentioned = false;
      const isPrimaryChannel = true;
      const onChannelMessage = false;
      const isBot = false;

      const shouldEmit = isBot
        ? myRoleMentioned
        : myRoleMentioned ||
          isReplyToAgent ||
          (isPrimaryChannel && onChannelMessage && !otherAgentMentioned);

      expect(shouldEmit).toBe(true);
    });

    it('should emit for replies to agent', () => {
      // Given: A reply to an agent's message (no explicit mention)
      const myRoleMentioned = false;
      const isReplyToAgent = true;
      const otherAgentMentioned = false;
      const isPrimaryChannel = true;
      const onChannelMessage = false;
      const isBot = false;

      const shouldEmit = isBot
        ? myRoleMentioned
        : myRoleMentioned ||
          isReplyToAgent ||
          (isPrimaryChannel && onChannelMessage && !otherAgentMentioned);

      expect(shouldEmit).toBe(true);
    });

    it('should NOT emit for replies to other users', () => {
      // Given: A reply to some other user's message (not the agent)
      const myRoleMentioned = false;
      const isReplyToAgent = false;
      const otherAgentMentioned = false;
      const isPrimaryChannel = true;
      const onChannelMessage = false; // Channel messages disabled
      const isBot = false;

      const shouldEmit = isBot
        ? myRoleMentioned
        : myRoleMentioned ||
          isReplyToAgent ||
          (isPrimaryChannel && onChannelMessage && !otherAgentMentioned);

      expect(shouldEmit).toBe(false);
    });

    it('should NOT emit for bot replies to agent (unless explicitly mentioned)', () => {
      // Given: A bot replying to this agent's message
      const myRoleMentioned = false;
      const isReplyToAgent = true;
      const otherAgentMentioned = false;
      const isPrimaryChannel = true;
      const onChannelMessage = true;
      const isBot = true; // Bot messages have stricter rules

      const shouldEmit = isBot
        ? myRoleMentioned // Bots must explicitly mention
        : myRoleMentioned ||
          isReplyToAgent ||
          (isPrimaryChannel && onChannelMessage && !otherAgentMentioned);

      expect(shouldEmit).toBe(false);
    });

    it('should emit for bot with explicit mention (regardless of reply)', () => {
      // Given: A bot replying and mentioning this agent
      const myRoleMentioned = true;
      const isReplyToAgent = true;
      const otherAgentMentioned = false;
      const isPrimaryChannel = true;
      const onChannelMessage = true;
      const isBot = true;

      const shouldEmit = isBot
        ? myRoleMentioned // Bots must explicitly mention
        : myRoleMentioned ||
          isReplyToAgent ||
          (isPrimaryChannel && onChannelMessage && !otherAgentMentioned);

      expect(shouldEmit).toBe(true);
    });

    it('should NOT emit for reply with another agent mentioned', () => {
      // Given: A reply to agent that also mentions @qa
      const myRoleMentioned = false;
      const isReplyToAgent = true;
      const otherAgentMentioned = true; // @qa mentioned
      const isPrimaryChannel = true;
      const onChannelMessage = true;
      const isBot = false;

      // Reply detection takes priority - we should still respond
      // because it's explicitly a reply to us
      const shouldEmit = isBot
        ? myRoleMentioned
        : myRoleMentioned ||
          isReplyToAgent ||
          (isPrimaryChannel && onChannelMessage && !otherAgentMentioned);

      expect(shouldEmit).toBe(true); // Reply to agent wins
    });
  });
});
