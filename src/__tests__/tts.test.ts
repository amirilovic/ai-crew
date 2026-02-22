/**
 * Tests for TTS (Text-to-Speech) functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
    unlinkSync: vi.fn(),
  };
});

describe('TTS (Text-to-Speech) Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset OPENAI_API_KEY for each test
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateSpeech', () => {
    it('returns error when OPENAI_API_KEY is not set', async () => {
      const { generateSpeech } = await import('../shared/services/tts.js');

      const result = await generateSpeech('Hello world');

      expect(result).toEqual({
        error: 'OPENAI_API_KEY is not configured. Cannot generate speech.',
        code: 'NO_API_KEY',
      });
    });

    it('successfully generates speech when API key is set', async () => {
      process.env.OPENAI_API_KEY = 'test-api-key';

      // Mock successful TTS API response
      const mockAudioBuffer = new ArrayBuffer(2048);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => mockAudioBuffer,
      });

      const { generateSpeech } = await import('../shared/services/tts.js');

      const result = await generateSpeech('Hello, this is a test message');

      expect(result).toHaveProperty('filePath');
      expect(result).toHaveProperty('durationEstimate');
      expect((result as { filePath: string }).filePath).toContain('tts_');
      expect((result as { filePath: string }).filePath).toContain('.opus');

      // Verify TTS API was called correctly
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const ttsCall = mockFetch.mock.calls[0];
      expect(ttsCall[0]).toBe('https://api.openai.com/v1/audio/speech');
      expect(ttsCall[1].headers.Authorization).toBe('Bearer test-api-key');
      expect(ttsCall[1].headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(ttsCall[1].body);
      expect(body.model).toBe('tts-1');
      expect(body.voice).toBe('alloy');
      expect(body.input).toBe('Hello, this is a test message');
      expect(body.response_format).toBe('opus');
    });

    it('uses specified voice', async () => {
      process.env.OPENAI_API_KEY = 'test-api-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1024),
      });

      const { generateSpeech } = await import('../shared/services/tts.js');

      await generateSpeech('Hello', 'nova');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.voice).toBe('nova');
    });

    it('handles text too long error', async () => {
      process.env.OPENAI_API_KEY = 'test-api-key';

      const { generateSpeech } = await import('../shared/services/tts.js');

      // Text longer than 4096 characters
      const longText = 'a'.repeat(5000);
      const result = await generateSpeech(longText);

      expect(result).toMatchObject({
        code: 'GENERATION_FAILED',
      });
      expect((result as { error: string }).error).toContain('Text too long');
      expect((result as { error: string }).error).toContain('5000');
    });

    it('handles TTS API error gracefully', async () => {
      process.env.OPENAI_API_KEY = 'test-api-key';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad request',
      });

      const { generateSpeech } = await import('../shared/services/tts.js');

      const result = await generateSpeech('Hello world');

      expect(result).toMatchObject({
        code: 'GENERATION_FAILED',
      });
      expect((result as { error: string }).error).toContain('400');
    });

    it('handles invalid API key', async () => {
      process.env.OPENAI_API_KEY = 'invalid-key';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid API key',
      });

      const { generateSpeech } = await import('../shared/services/tts.js');

      const result = await generateSpeech('Hello world');

      expect(result).toEqual({
        error: 'Invalid OpenAI API key',
        code: 'GENERATION_FAILED',
      });
    });

    it('handles file too large error', async () => {
      process.env.OPENAI_API_KEY = 'test-api-key';

      // Mock response with file larger than 8MB
      const largeBuffer = new ArrayBuffer(9 * 1024 * 1024);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => largeBuffer,
      });

      const { generateSpeech } = await import('../shared/services/tts.js');

      const result = await generateSpeech('Hello world');

      expect(result).toMatchObject({
        code: 'FILE_TOO_LARGE',
      });
      expect((result as { error: string }).error).toContain('8MB limit');
    });
  });

  describe('isValidVoice', () => {
    it('returns true for valid voices', async () => {
      const { isValidVoice } = await import('../shared/services/tts.js');

      expect(isValidVoice('alloy')).toBe(true);
      expect(isValidVoice('echo')).toBe(true);
      expect(isValidVoice('fable')).toBe(true);
      expect(isValidVoice('onyx')).toBe(true);
      expect(isValidVoice('nova')).toBe(true);
      expect(isValidVoice('shimmer')).toBe(true);
    });

    it('returns false for invalid voices', async () => {
      const { isValidVoice } = await import('../shared/services/tts.js');

      expect(isValidVoice('invalid')).toBe(false);
      expect(isValidVoice('')).toBe(false);
      expect(isValidVoice('ALLOY')).toBe(false); // case sensitive
    });
  });

  describe('TTS_VOICES', () => {
    it('contains all expected voices with descriptions', async () => {
      const { TTS_VOICES } = await import('../shared/services/tts.js');

      expect(TTS_VOICES).toHaveProperty('alloy');
      expect(TTS_VOICES).toHaveProperty('echo');
      expect(TTS_VOICES).toHaveProperty('fable');
      expect(TTS_VOICES).toHaveProperty('onyx');
      expect(TTS_VOICES).toHaveProperty('nova');
      expect(TTS_VOICES).toHaveProperty('shimmer');

      // Each voice should have a description
      Object.values(TTS_VOICES).forEach((description) => {
        expect(typeof description).toBe('string');
        expect(description.length).toBeGreaterThan(0);
      });
    });
  });

  describe('cleanupTTSFile', () => {
    it('removes file if it exists', async () => {
      const { cleanupTTSFile } = await import('../shared/services/tts.js');

      cleanupTTSFile('/tmp/test-file.opus');

      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/test-file.opus');
    });

    it('does not throw if file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(false);

      const { cleanupTTSFile } = await import('../shared/services/tts.js');

      expect(() => cleanupTTSFile('/tmp/nonexistent.opus')).not.toThrow();
    });
  });
});
