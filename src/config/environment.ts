import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load base .env first
config();

const envSchema = z.object({
  // ANTHROPIC_API_KEY is read directly by the Agent SDK from environment
  // DISCORD_TOKEN is optional in root .env - can come from agent-specific .env
  DISCORD_TOKEN: z.string().optional(),
  DISCORD_GUILD_ID: z.string().min(1, 'DISCORD_GUILD_ID is required'),
  MAX_DAILY_COST_USD: z.string().transform(Number).pipe(z.number().positive()).default('50'),
  AGENT_NAME: z.string().optional(),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  // OpenAI API key for Whisper transcription (voice messages)
  OPENAI_API_KEY: z.string().optional(),
});

// Load agent-specific .env file (overrides base .env)
export function loadAgentEnv(agentName: string): void {
  const agentEnvPath = join(__dirname, '..', 'agents', agentName, '.env');
  config({ path: agentEnvPath, override: true });
  // Clear cached env so it reloads with agent-specific values
  cachedEnv = null;
}

export type Environment = z.infer<typeof envSchema>;

let cachedEnv: Environment | null = null;

export function loadEnvironment(): Environment {
  if (cachedEnv) {
    return cachedEnv;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${errors}`);
  }

  cachedEnv = result.data;
  return cachedEnv;
}

export function getEnv(): Environment {
  if (!cachedEnv) {
    return loadEnvironment();
  }
  return cachedEnv;
}
