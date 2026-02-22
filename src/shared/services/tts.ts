import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from '../logger.js';

export type TTSVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

export interface TTSResult {
  filePath: string;
  durationEstimate?: number;
}

export interface TTSError {
  error: string;
  code: 'NO_API_KEY' | 'GENERATION_FAILED' | 'FILE_TOO_LARGE';
}

/**
 * Available TTS voices with descriptions
 */
export const TTS_VOICES: Record<TTSVoice, string> = {
  alloy: 'Neutral and balanced',
  echo: 'Warm and clear',
  fable: 'British and expressive',
  onyx: 'Deep and authoritative',
  nova: 'Friendly and upbeat',
  shimmer: 'Soft and gentle',
};

/**
 * Generate speech from text using OpenAI TTS API
 * Returns the path to the generated audio file
 */
export async function generateSpeech(
  text: string,
  voice: TTSVoice = 'alloy'
): Promise<TTSResult | TTSError> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      error: 'OPENAI_API_KEY is not configured. Cannot generate speech.',
      code: 'NO_API_KEY',
    };
  }

  // Validate text length (OpenAI limit is 4096 characters)
  if (text.length > 4096) {
    return {
      error: `Text too long (${text.length} chars). Maximum is 4096 characters.`,
      code: 'GENERATION_FAILED',
    };
  }

  try {
    logger.info('Generating speech with TTS', {
      textLength: text.length,
      voice,
      textPreview: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
    });

    // Call OpenAI TTS API
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: voice,
        input: text,
        response_format: 'opus', // Efficient format for Discord voice
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('TTS API error', { status: response.status, error: errorText });

      if (response.status === 401) {
        return {
          error: 'Invalid OpenAI API key',
          code: 'GENERATION_FAILED',
        };
      }

      return {
        error: `TTS API error: ${response.status} - ${errorText}`,
        code: 'GENERATION_FAILED',
      };
    }

    // Get the audio buffer
    const audioBuffer = await response.arrayBuffer();
    const audioSize = audioBuffer.byteLength;

    logger.info('TTS audio generated', { size: audioSize });

    // Check if the file would exceed Discord's limit
    const maxSize = 8 * 1024 * 1024; // 8MB
    if (audioSize > maxSize) {
      return {
        error: `Generated audio (${(audioSize / 1024 / 1024).toFixed(2)}MB) exceeds Discord's 8MB limit. Try shorter text.`,
        code: 'FILE_TOO_LARGE',
      };
    }

    // Save to temp file
    const tempDir = os.tmpdir();
    const tempPath = path.join(tempDir, `tts_${Date.now()}.opus`);
    fs.writeFileSync(tempPath, Buffer.from(audioBuffer));

    logger.info('TTS audio saved to temp file', { path: tempPath, size: audioSize });

    // Rough duration estimate: ~150 words per minute, ~5 chars per word
    const estimatedDuration = Math.ceil((text.length / 5 / 150) * 60);

    return {
      filePath: tempPath,
      durationEstimate: estimatedDuration,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('TTS generation failed', { error: errorMessage });

    return {
      error: `TTS generation failed: ${errorMessage}`,
      code: 'GENERATION_FAILED',
    };
  }
}

/**
 * Clean up a generated TTS file
 */
export function cleanupTTSFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info('Cleaned up TTS temp file', { path: filePath });
    }
  } catch (error) {
    logger.warn('Failed to cleanup TTS temp file', { filePath, error });
  }
}

/**
 * Validate that a voice is valid
 */
export function isValidVoice(voice: string): voice is TTSVoice {
  return voice in TTS_VOICES;
}
