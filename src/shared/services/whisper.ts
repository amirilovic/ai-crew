import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from '../logger.js';

export interface TranscriptionResult {
  text: string;
  durationSeconds?: number;
  language?: string;
}

export interface WhisperError {
  error: string;
  code: 'NO_API_KEY' | 'DOWNLOAD_FAILED' | 'TRANSCRIPTION_FAILED' | 'INVALID_AUDIO';
}

/**
 * Download a file from a URL to a temporary location
 */
async function downloadFile(url: string, filename: string): Promise<string> {
  const tempDir = os.tmpdir();
  const tempPath = path.join(tempDir, `whisper_${Date.now()}_${filename}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  fs.writeFileSync(tempPath, Buffer.from(buffer));

  return tempPath;
}

/**
 * Clean up temporary file
 */
function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    logger.warn('Failed to cleanup temp file', { filePath, error });
  }
}

/**
 * Transcribe audio using OpenAI Whisper API
 */
export async function transcribeAudio(
  audioUrl: string,
  filename: string
): Promise<TranscriptionResult | WhisperError> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      error: 'OPENAI_API_KEY is not configured. Cannot transcribe voice messages.',
      code: 'NO_API_KEY',
    };
  }

  let tempFilePath: string | null = null;

  try {
    // Download the audio file
    logger.info('Downloading audio file for transcription', { url: audioUrl, filename });
    tempFilePath = await downloadFile(audioUrl, filename);

    // Get file stats for logging
    const stats = fs.statSync(tempFilePath);
    logger.info('Audio file downloaded', { size: stats.size, path: tempFilePath });

    // Read the file and create FormData
    const audioBuffer = fs.readFileSync(tempFilePath);
    const blob = new Blob([audioBuffer], { type: 'audio/ogg' });

    // Create form data for Whisper API
    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');

    // Call Whisper API
    logger.info('Calling Whisper API for transcription');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Whisper API error', { status: response.status, error: errorText });

      if (response.status === 401) {
        return {
          error: 'Invalid OpenAI API key',
          code: 'TRANSCRIPTION_FAILED',
        };
      }

      return {
        error: `Whisper API error: ${response.status} - ${errorText}`,
        code: 'TRANSCRIPTION_FAILED',
      };
    }

    const result = (await response.json()) as {
      text: string;
      duration?: number;
      language?: string;
    };

    logger.info('Transcription successful', {
      textLength: result.text.length,
      duration: result.duration,
      language: result.language,
    });

    return {
      text: result.text,
      durationSeconds: result.duration,
      language: result.language,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Transcription failed', { error: errorMessage });

    if (errorMessage.includes('download')) {
      return {
        error: `Failed to download audio: ${errorMessage}`,
        code: 'DOWNLOAD_FAILED',
      };
    }

    return {
      error: `Transcription failed: ${errorMessage}`,
      code: 'TRANSCRIPTION_FAILED',
    };
  } finally {
    // Clean up temp file
    if (tempFilePath) {
      cleanupTempFile(tempFilePath);
    }
  }
}

/**
 * Check if an attachment is a voice message
 * Discord voice messages have specific content types
 */
export function isVoiceMessage(attachment: {
  contentType?: string | null;
  filename?: string | null;
}): boolean {
  const contentType = attachment.contentType?.toLowerCase() || '';
  const filename = attachment.filename?.toLowerCase() || '';

  // Discord voice messages are typically audio/ogg or audio/mpeg
  const voiceContentTypes = ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm'];

  // Check content type
  if (voiceContentTypes.some((type) => contentType.includes(type))) {
    return true;
  }

  // Check file extension as fallback
  const voiceExtensions = ['.ogg', '.mp3', '.m4a', '.wav', '.webm', '.opus'];
  if (voiceExtensions.some((ext) => filename.endsWith(ext))) {
    return true;
  }

  return false;
}
