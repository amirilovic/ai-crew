import { loadEnvironment } from './config/environment.js';
import { createLogger } from './shared/logger.js';
import { loadAgent, startAgent } from './shared/runner/index.js';

async function main(): Promise<void> {
  // Load and validate environment variables
  const env = loadEnvironment();

  const agentName = env.AGENT_NAME;
  if (!agentName) {
    console.error('AGENT_NAME environment variable is required');
    console.error('Usage: AGENT_NAME=po node dist/index.js');
    console.error('       AGENT_NAME=dev node dist/index.js');
    process.exit(1);
  }

  const logger = createLogger(agentName);
  logger.info('Starting agent', { agentName });

  try {
    // Load agent configuration, prompt, and tools
    const agent = await loadAgent(agentName);

    // Start the agent with triggers
    await startAgent(agent);
  } catch (error) {
    logger.error('Failed to start agent', { error });
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
