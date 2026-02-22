/**
 * Discord MCP Tools
 *
 * Creates MCP tools for Discord operations using the DiscordChannelAdapter.
 */

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { logger } from '../../../shared/logger.js';
import { transcribeAudio } from '../../../shared/services/whisper.js';
import { generateSpeech, cleanupTTSFile, type TTSVoice } from '../../../shared/services/tts.js';
import type { DiscordChannelAdapter } from './adapter.js';

/**
 * Create Discord MCP tools for an agent
 */
export function createDiscordMcpTools(adapter: DiscordChannelAdapter) {
  const readChannelTool = tool(
    'discord_read_channel',
    'Read messages from a Discord channel. Returns messages in chronological order.',
    {
      channel: z.string().describe('The channel name or ID to read from'),
      limit: z.number().min(1).max(100).default(50).describe('Maximum number of messages to fetch'),
    },
    async (input) => {
      const messages = await adapter.readMessages({
        channel: input.channel,
        limit: input.limit,
      });

      const result = {
        channel: input.channel,
        channelId: messages[0]?.channelId ?? '',
        messageCount: messages.length,
        messages: messages.map((msg) => ({
          id: msg.id,
          author: msg.author.name,
          authorId: msg.author.id,
          content: msg.content,
          timestamp: msg.timestamp.toISOString(),
          attachments: msg.attachments.map((att) => ({
            id: att.id,
            filename: att.filename,
            url: att.url,
            contentType: att.contentType,
            size: att.size,
          })),
        })),
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }
  );

  const postMessageTool = tool(
    'discord_post_message',
    'Post a message to a Discord channel. Can optionally reply to another message. Use @rolename to mention roles (e.g., @dev, @po).',
    {
      channel: z.string().describe('The channel name or ID to post to'),
      content: z.string().describe('The message content to post'),
      replyTo: z.string().optional().describe('Message ID to reply to'),
    },
    async (input) => {
      const result = await adapter.sendMessage({
        channel: input.channel,
        content: input.content,
        replyTo: input.replyTo,
      });

      if (!result.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              channel: input.channel,
              messageId: result.messageId,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      };
    }
  );

  const sendFileTool = tool(
    'discord_send_file',
    'Send a file (image, document, etc.) to a Discord channel with an optional message. Maximum file size is 8MB.',
    {
      channel: z.string().describe('The channel name or ID to send to'),
      filePath: z.string().describe('The absolute path to the file to send'),
      content: z.string().optional().describe('Optional message text to include with the file'),
    },
    async (input) => {
      const result = await adapter.sendFile({
        channel: input.channel,
        filePath: input.filePath,
        content: input.content,
      });

      if (!result.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              channel: input.channel,
              messageId: result.messageId,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      };
    }
  );

  const transcribeVoiceTool = tool(
    'discord_transcribe_voice',
    'Transcribe a voice message from Discord using OpenAI Whisper. Pass the attachment URL and filename from a voice message attachment.',
    {
      audioUrl: z
        .string()
        .describe('The URL of the audio file to transcribe (from attachment.url)'),
      filename: z.string().describe('The filename of the audio file (from attachment.filename)'),
    },
    async (input) => {
      logger.info('Transcribing voice message', { url: input.audioUrl, filename: input.filename });

      const result = await transcribeAudio(input.audioUrl, input.filename);

      if ('error' in result) {
        logger.error('Transcription failed', { error: result.error, code: result.code });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      }

      logger.info('Transcription successful', {
        textLength: result.text.length,
        duration: result.durationSeconds,
        language: result.language,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              transcription: result.text,
              durationSeconds: result.durationSeconds,
              language: result.language,
            }),
          },
        ],
      };
    }
  );

  const sendVoiceTool = tool(
    'discord_send_voice',
    'Generate speech from text using OpenAI TTS and send it as a voice message to a Discord channel. Available voices: alloy (neutral), echo (warm), fable (British), onyx (deep), nova (friendly), shimmer (soft).',
    {
      channel: z.string().describe('The channel name or ID to send to'),
      text: z.string().max(4096).describe('The text to convert to speech (max 4096 chars)'),
      voice: z
        .enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'])
        .default('alloy')
        .describe('The voice to use'),
      content: z
        .string()
        .optional()
        .describe('Optional text message to include with the voice message'),
    },
    async (input) => {
      logger.info('Generating voice message', {
        channel: input.channel,
        textLength: input.text.length,
        voice: input.voice,
      });

      // Generate speech
      const ttsResult = await generateSpeech(input.text, input.voice as TTSVoice);

      if ('error' in ttsResult) {
        logger.error('TTS generation failed', { error: ttsResult.error, code: ttsResult.code });
        return { content: [{ type: 'text' as const, text: JSON.stringify(ttsResult) }] };
      }

      try {
        // Send the voice file using the adapter
        const sendResult = await adapter.sendFile({
          channel: input.channel,
          filePath: ttsResult.filePath,
          content: input.content,
        });

        // Clean up temp file
        cleanupTTSFile(ttsResult.filePath);

        if (!sendResult.success) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: sendResult.error }) }],
          };
        }

        logger.info('Voice message sent to Discord', {
          channel: input.channel,
          messageId: sendResult.messageId,
          voice: input.voice,
          textLength: input.text.length,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                channel: input.channel,
                messageId: sendResult.messageId,
                timestamp: new Date().toISOString(),
                voice: input.voice,
                textLength: input.text.length,
                durationEstimate: ttsResult.durationEstimate,
              }),
            },
          ],
        };
      } catch (error) {
        // Clean up on error
        cleanupTTSFile(ttsResult.filePath);
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to send voice message to Discord', { error: errorMessage });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `Failed to send voice message: ${errorMessage}` }),
            },
          ],
        };
      }
    }
  );

  const addReactionTool = tool(
    'discord_add_reaction',
    'Add an emoji reaction to a Discord message. Use this for quick acknowledgments, status updates, or approvals.',
    {
      channel: z.string().describe('The channel name or ID where the message is'),
      messageId: z.string().describe('The message ID to react to'),
      emoji: z.string().describe('Unicode emoji or custom emoji name (:custom:)'),
    },
    async (input) => {
      const result = await adapter.addReaction({
        channel: input.channel,
        messageId: input.messageId,
        emoji: input.emoji,
      });

      if (!result.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              channel: input.channel,
              channelId: input.channel,
              messageId: input.messageId,
              emoji: input.emoji,
            }),
          },
        ],
      };
    }
  );

  return [
    readChannelTool,
    postMessageTool,
    sendFileTool,
    transcribeVoiceTool,
    sendVoiceTool,
    addReactionTool,
  ];
}
