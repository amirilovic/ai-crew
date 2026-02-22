import { Client, GatewayIntentBits } from 'discord.js';
import { getEnv } from '../../config/environment.js';
import { logger } from '../logger.js';

let discordClient: Client | null = null;
let clientPromise: Promise<Client> | null = null;

export async function getDiscordClient(): Promise<Client> {
  if (discordClient && discordClient.isReady()) {
    return discordClient;
  }

  // Prevent multiple simultaneous connection attempts
  if (clientPromise) {
    return clientPromise;
  }

  const env = getEnv();

  if (!env.DISCORD_TOKEN) {
    throw new Error(
      "DISCORD_TOKEN is required. Set it in the agent's .env file (e.g., src/agents/dev/.env)"
    );
  }

  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions, // Required for adding reactions
    ],
  });

  clientPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clientPromise = null;
      reject(new Error('Discord client failed to become ready within 30 seconds'));
    }, 30000);

    discordClient!.once('ready', () => {
      clearTimeout(timeout);
      logger.info('Discord client connected', {
        botUser: discordClient!.user?.tag,
      });
      resolve(discordClient!);
    });

    discordClient!.once('error', (error) => {
      clearTimeout(timeout);
      clientPromise = null;
      reject(error);
    });

    // Login AFTER setting up listeners
    discordClient!.login(env.DISCORD_TOKEN).catch((err) => {
      clearTimeout(timeout);
      clientPromise = null;
      reject(err);
    });
  });

  return clientPromise;
}

export async function disconnectDiscord(): Promise<void> {
  if (discordClient) {
    discordClient.destroy();
    discordClient = null;
    logger.info('Discord client disconnected');
  }
}
