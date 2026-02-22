/**
 * Tests for Whisper voice message transcription functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => Buffer.from('mock audio data')),
    statSync: vi.fn(() => ({ size: 1024 })),
    existsSync: vi.fn(() => true),
    unlinkSync: vi.fn(),
  };
});

describe('Whisper Transcription Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset OPENAI_API_KEY for each test
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('transcribeAudio', () => {
    it('returns error when OPENAI_API_KEY is not set', async () => {
      const { transcribeAudio } = await import('../shared/services/whisper.js');

      const result = await transcribeAudio(
        'https://cdn.discordapp.com/attachments/123/456/voice.ogg',
        'voice.ogg'
      );

      expect(result).toEqual({
        error: 'OPENAI_API_KEY is not configured. Cannot transcribe voice messages.',
        code: 'NO_API_KEY',
      });
    });

    it('successfully transcribes audio when API key is set', async () => {
      process.env.OPENAI_API_KEY = 'test-api-key';

      // Mock successful download
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1024),
      });

      // Mock successful Whisper API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: 'Hello, this is a test message',
          duration: 5.5,
          language: 'en',
        }),
      });

      const { transcribeAudio } = await import('../shared/services/whisper.js');

      const result = await transcribeAudio(
        'https://cdn.discordapp.com/attachments/123/456/voice.ogg',
        'voice.ogg'
      );

      expect(result).toEqual({
        text: 'Hello, this is a test message',
        durationSeconds: 5.5,
        language: 'en',
      });

      // Verify Whisper API was called with correct auth
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const whisperCall = mockFetch.mock.calls[1];
      expect(whisperCall[0]).toBe('https://api.openai.com/v1/audio/transcriptions');
      expect(whisperCall[1].headers.Authorization).toBe('Bearer test-api-key');
    });

    it('handles download failure gracefully', async () => {
      process.env.OPENAI_API_KEY = 'test-api-key';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const { transcribeAudio } = await import('../shared/services/whisper.js');

      const result = await transcribeAudio(
        'https://cdn.discordapp.com/attachments/123/456/voice.ogg',
        'voice.ogg'
      );

      expect(result).toMatchObject({
        code: 'DOWNLOAD_FAILED',
      });
      expect((result as { error: string }).error).toContain('download');
    });

    it('handles Whisper API error gracefully', async () => {
      process.env.OPENAI_API_KEY = 'test-api-key';

      // Mock successful download
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1024),
      });

      // Mock Whisper API error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Invalid audio format',
      });

      const { transcribeAudio } = await import('../shared/services/whisper.js');

      const result = await transcribeAudio(
        'https://cdn.discordapp.com/attachments/123/456/voice.ogg',
        'voice.ogg'
      );

      expect(result).toMatchObject({
        code: 'TRANSCRIPTION_FAILED',
      });
      expect((result as { error: string }).error).toContain('400');
    });

    it('handles invalid API key', async () => {
      process.env.OPENAI_API_KEY = 'invalid-key';

      // Mock successful download
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1024),
      });

      // Mock Whisper API 401 error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid API key',
      });

      const { transcribeAudio } = await import('../shared/services/whisper.js');

      const result = await transcribeAudio(
        'https://cdn.discordapp.com/attachments/123/456/voice.ogg',
        'voice.ogg'
      );

      expect(result).toEqual({
        error: 'Invalid OpenAI API key',
        code: 'TRANSCRIPTION_FAILED',
      });
    });
  });

  describe('isVoiceMessage', () => {
    it('identifies audio/ogg as voice message', async () => {
      const { isVoiceMessage } = await import('../shared/services/whisper.js');

      expect(isVoiceMessage({ contentType: 'audio/ogg', filename: 'voice.ogg' })).toBe(true);
    });

    it('identifies audio/mpeg as voice message', async () => {
      const { isVoiceMessage } = await import('../shared/services/whisper.js');

      expect(isVoiceMessage({ contentType: 'audio/mpeg', filename: 'audio.mp3' })).toBe(true);
    });

    it('identifies audio/wav as voice message', async () => {
      const { isVoiceMessage } = await import('../shared/services/whisper.js');

      expect(isVoiceMessage({ contentType: 'audio/wav', filename: 'audio.wav' })).toBe(true);
    });

    it('identifies by file extension when content type is missing', async () => {
      const { isVoiceMessage } = await import('../shared/services/whisper.js');

      expect(isVoiceMessage({ contentType: null, filename: 'voice.ogg' })).toBe(true);
      expect(isVoiceMessage({ contentType: null, filename: 'audio.mp3' })).toBe(true);
      expect(isVoiceMessage({ contentType: null, filename: 'sound.wav' })).toBe(true);
    });

    it('returns false for non-audio files', async () => {
      const { isVoiceMessage } = await import('../shared/services/whisper.js');

      expect(isVoiceMessage({ contentType: 'image/png', filename: 'photo.png' })).toBe(false);
      expect(isVoiceMessage({ contentType: 'text/plain', filename: 'notes.txt' })).toBe(false);
      expect(isVoiceMessage({ contentType: 'application/pdf', filename: 'doc.pdf' })).toBe(false);
    });

    it('handles undefined content type and filename', async () => {
      const { isVoiceMessage } = await import('../shared/services/whisper.js');

      expect(isVoiceMessage({ contentType: undefined, filename: undefined })).toBe(false);
      expect(isVoiceMessage({ contentType: null, filename: null })).toBe(false);
    });
  });
});
