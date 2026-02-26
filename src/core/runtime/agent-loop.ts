/**
 * AgentLoop - Generic agent execution loop
 *
 * Handles Claude API interaction, tool dispatch, and response handling.
 * Adapter-agnostic: receives tools from callers, doesn't create them.
 */

import {
  query,
  createSdkMcpServer,
  type SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk';
import { logger } from '../../shared/logger.js';
import { CostTracker } from '../../shared/guardrails/cost-tracker.js';

/**
 * API provider configuration for custom endpoints
 */
export interface ApiConfig {
  /** Custom API endpoint URL (e.g., "https://openrouter.ai/api") */
  baseUrl?: string;
  /** Environment variable name containing the API key (default: "ANTHROPIC_API_KEY") */
  apiKey?: string;
  /** Additional headers to include in requests */
  headers?: Record<string, string>;
}

/**
 * Configuration for running an agent loop
 */
export interface AgentLoopConfig {
  /** Agent name for logging */
  name: string;
  /** System prompt for the agent */
  systemPrompt: string;
  /** Model to use (for cost tracking) */
  model: string;
  /** Optional path to Claude executable */
  claudeExecutable?: string;
  /** Optional API provider configuration */
  api?: ApiConfig;
  /** Conversation timeout in milliseconds (default: 5 minutes) */
  conversationTimeoutMs?: number;
}

/**
 * MCP Server configuration
 */
export interface McpServerConfig {
  name: string;
  tools: SdkMcpToolDefinition<any>[]; // MCP tools from the SDK
}

/**
 * Options for running the agent loop
 */
export interface AgentLoopOptions {
  /** Cost tracker for budget management */
  costTracker: CostTracker;
  /** MCP servers with tools to make available */
  mcpServers: McpServerConfig[];
  /** Session ID to resume, if any */
  sessionId?: string;
  /** Callback for status updates */
  onStatusUpdate?: (status: string) => Promise<void>;
  /** Callback for tool use - receives tool name and input */
  onToolUse?: (toolName: string, input: Record<string, unknown>) => void;
}

/**
 * Result from running the agent loop
 */
export interface AgentLoopResult {
  /** Final response text from the agent */
  response: string;
  /** Number of turns taken */
  turns: number;
  /** Total cost in USD */
  costUsd: number;
  /** Session ID for resumption */
  sessionId?: string;
}

/**
 * Run the agent loop with the given configuration and prompt
 */
export async function runAgentLoop(
  config: AgentLoopConfig,
  prompt: string,
  options: AgentLoopOptions
): Promise<AgentLoopResult> {
  const {
    costTracker,
    mcpServers,
    sessionId: resumeSessionId,
    onStatusUpdate,
    onToolUse,
  } = options;

  // Helper to update status (non-blocking)
  const updateStatus = (status: string) => {
    if (onStatusUpdate) {
      onStatusUpdate(status).catch(() => {});
    }
  };

  // Check cost limits before starting
  costTracker.checkLimit();

  // Create MCP servers from config
  const servers: Record<string, ReturnType<typeof createSdkMcpServer>> = {};
  for (const serverConfig of mcpServers) {
    servers[serverConfig.name] = createSdkMcpServer({
      name: serverConfig.name,
      tools: serverConfig.tools,
    });
  }

  let finalResponse = '';
  let totalCost = 0;
  let turnCount = 0;
  let currentSessionId: string | undefined;

  const isResuming = !!resumeSessionId;
  logger.info('🚀 Agent loop starting', {
    agent: config.name,
    promptPreview: prompt.substring(0, 100) + '...',
    resumingSession: isResuming,
    sessionId: resumeSessionId,
    mcpServers: mcpServers.map((s) => s.name),
  });

  updateStatus(isResuming ? '🔄 Resuming session...' : '🤔 Thinking...');

  // Build environment variables for API configuration
  // The Claude CLI uses these env vars to configure API access:
  // - ANTHROPIC_API_KEY: Must be empty when using custom providers like OpenRouter
  // - ANTHROPIC_AUTH_TOKEN: Auth token for custom providers (e.g., OpenRouter API key)
  // - ANTHROPIC_BASE_URL: Custom API endpoint (e.g., https://openrouter.ai/api)
  // - ANTHROPIC_CUSTOM_HEADERS: Additional headers (newline-separated key: value pairs)
  // See: https://openrouter.ai/docs/guides/guides/claude-code-integration
  const customEnv: Record<string, string | undefined> = { ...process.env };

  if (config.api) {
    // When using a custom base URL (like OpenRouter), we need to:
    // 1. Set ANTHROPIC_BASE_URL to the custom endpoint
    // 2. Set ANTHROPIC_API_KEY to empty string (required for OpenRouter)
    // 3. Set ANTHROPIC_AUTH_TOKEN to the custom API key
    if (config.api.baseUrl) {
      customEnv['ANTHROPIC_BASE_URL'] = config.api.baseUrl;
      customEnv['ANTHROPIC_API_KEY'] = ''; // Must be empty for OpenRouter
      logger.info('Using custom API base URL', { baseUrl: config.api.baseUrl });
    }

    // Set custom API key via ANTHROPIC_AUTH_TOKEN (for OpenRouter compatibility)
    if (config.api.apiKey) {
      const apiKeyValue = process.env[config.api.apiKey];
      if (apiKeyValue) {
        customEnv['ANTHROPIC_AUTH_TOKEN'] = apiKeyValue;
        logger.info('Using custom API auth token', { envVar: config.api.apiKey });
      } else {
        logger.warn('Custom API key env var not set', { envVar: config.api.apiKey });
      }
    }

    // Set custom headers via environment variable (newline-separated key: value pairs)
    if (config.api.headers && Object.keys(config.api.headers).length > 0) {
      const headerStrings = Object.entries(config.api.headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
      customEnv['ANTHROPIC_CUSTOM_HEADERS'] = headerStrings;
      logger.info('Using custom API headers', {
        headerCount: Object.keys(config.api.headers).length,
      });
    }
  }

  // Set up conversation timeout (default: 5 minutes)
  const timeoutMs = config.conversationTimeoutMs ?? 5 * 60 * 1000;
  let lastMessageTime = Date.now();
  let timeoutHandle: NodeJS.Timeout | null = null;
  let timeoutReject: ((error: Error) => void) | null = null;

  // Create a promise that rejects on timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutReject = reject;
  });

  // Start timeout monitoring
  const startTimeout = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    timeoutHandle = setTimeout(() => {
      const elapsed = Date.now() - lastMessageTime;
      logger.error('Conversation timeout - no response from Claude', {
        agent: config.name,
        timeoutMs,
        elapsedMs: elapsed,
        lastMessageAt: new Date(lastMessageTime).toISOString(),
      });
      if (timeoutReject) {
        timeoutReject(
          new Error(`Conversation timeout after ${timeoutMs}ms - Claude did not respond`)
        );
      }
    }, timeoutMs);
  };

  // Reset timeout on each message
  const resetTimeout = () => {
    lastMessageTime = Date.now();
    startTimeout();
  };

  // Wrap the query loop in a promise so we can race it with timeout
  const queryLoopPromise = async () => {
    for await (const message of query({
      prompt,
      options: {
        model: config.model,
        systemPrompt: config.systemPrompt,
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers: servers,
        // When using custom API config, don't load user settings (which may have conflicting env vars)
        // Otherwise, load user settings for gateway config
        settingSources: config.api ? [] : ['user'],
        // Pass custom environment for API configuration
        ...(config.api && { env: customEnv }),
        // Resume previous session if provided
        ...(resumeSessionId && { resume: resumeSessionId }),
        // Use custom Claude executable if specified
        ...(config.claudeExecutable && {
          pathToClaudeCodeExecutable: config.claudeExecutable,
        }),
      },
    })) {
      // Reset timeout on every message received
      resetTimeout();
      // Log different message types
      if (message.type === 'system' && message.subtype === 'init') {
        currentSessionId = message.session_id;
        logger.info('📋 Agent session initialized', {
          sessionId: currentSessionId,
          resumed: isResuming,
        });
      }

      if (message.type === 'assistant' && message.message?.content) {
        turnCount++;
        logger.info(`🤖 Agent turn ${turnCount}`);

        for (const block of message.message.content) {
          if ('text' in block && block.text) {
            // Log text response (truncated for readability)
            const preview =
              block.text.length > 200 ? block.text.substring(0, 200) + '...' : block.text;
            logger.info('💬 Agent thinking', { response: preview });
            finalResponse = block.text;
          }

          if ('type' in block && block.type === 'tool_use') {
            const toolBlock = block as { type: 'tool_use'; name: string; input: unknown };
            // Log tool calls with details
            const inputPreview = JSON.stringify(toolBlock.input);
            const truncatedInput =
              inputPreview.length > 150 ? inputPreview.substring(0, 150) + '...' : inputPreview;
            logger.info(`🔧 Tool call: ${toolBlock.name}`, { input: truncatedInput });

            // Notify caller about tool use
            const input = toolBlock.input as Record<string, unknown>;
            if (onToolUse) {
              onToolUse(toolBlock.name, input);
            }

            // Generate status message for built-in tools
            const status = getToolStatusMessage(toolBlock.name, input);
            updateStatus(status);
          }
        }
      }

      // Log tool results
      if (message.type === 'user' && message.message?.content) {
        for (const block of message.message.content) {
          if ('type' in block && block.type === 'tool_result') {
            const resultBlock = block as {
              type: 'tool_result';
              tool_use_id: string;
              content?: string;
            };
            const contentPreview = resultBlock.content
              ? resultBlock.content.length > 100
                ? resultBlock.content.substring(0, 100) + '...'
                : resultBlock.content
              : '(no content)';
            logger.info('📥 Tool result received', { preview: contentPreview });
          }
        }
      }

      if (message.type === 'result') {
        logger.info('✅ Agent completed', {
          subtype: message.subtype,
          turns: turnCount,
          durationMs: message.duration_ms,
          costUsd: message.total_cost_usd?.toFixed(4),
        });
        totalCost = message.total_cost_usd || 0;

        // Track token usage from SDK's actual data instead of estimating
        // SDK provides accurate token counts per model in result.modelUsage
        if (message.modelUsage) {
          for (const [model, usage] of Object.entries(message.modelUsage)) {
            const typedUsage = usage as {
              inputTokens: number;
              outputTokens: number;
              costUSD: number;
            };
            costTracker.trackUsage(typedUsage.inputTokens, typedUsage.outputTokens, model);
            logger.debug('📊 Token usage tracked', {
              model,
              inputTokens: typedUsage.inputTokens,
              outputTokens: typedUsage.outputTokens,
              costUSD: typedUsage.costUSD.toFixed(4),
            });
          }
        } else {
          // Fallback: If modelUsage isn't available, track at least the total cost
          // This shouldn't happen with current SDK versions, but provides backwards compatibility
          logger.warn('⚠️  modelUsage not available in result message, using fallback estimation');
          const estimatedOutputTokens = Math.round((totalCost / 15) * 1_000_000);
          costTracker.trackUsage(0, estimatedOutputTokens, config.model);
        }
      }
    }
  };

  try {
    startTimeout(); // Start initial timeout

    // Race the query loop against the timeout
    await Promise.race([queryLoopPromise(), timeoutPromise]);

    // Clear timeout on successful completion
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    logger.error('Agent loop error', { error: err });

    // Clear timeout on error
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    throw error;
  }

  return {
    response: finalResponse,
    turns: turnCount,
    costUsd: totalCost,
    sessionId: currentSessionId,
  };
}

/**
 * Generate a user-friendly status message for a tool call
 */
function getToolStatusMessage(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash': {
      const cmd = String(input.command || '').split(' ')[0];
      return `⚙️ Running \`${cmd}\`...`;
    }
    case 'Read': {
      const filePath = String(input.file_path || '');
      const fileName = filePath.split('/').pop() || 'file';
      return `📄 Reading \`${fileName}\`...`;
    }
    case 'Write': {
      const filePath = String(input.file_path || '');
      const fileName = filePath.split('/').pop() || 'file';
      return `📝 Writing \`${fileName}\`...`;
    }
    case 'Edit': {
      const filePath = String(input.file_path || '');
      const fileName = filePath.split('/').pop() || 'file';
      return `✏️ Editing \`${fileName}\`...`;
    }
    case 'Glob': {
      const pattern = String(input.pattern || '*');
      return `🔍 Finding \`${pattern}\`...`;
    }
    case 'Grep': {
      const pattern = String(input.pattern || '');
      const truncated = pattern.length > 20 ? pattern.substring(0, 20) + '...' : pattern;
      return `🔎 Searching for "${truncated}"...`;
    }
    case 'WebSearch': {
      const query = String(input.query || '');
      const truncated = query.length > 30 ? query.substring(0, 30) + '...' : query;
      return `🌐 Searching: "${truncated}"...`;
    }
    case 'WebFetch': {
      const url = String(input.url || '');
      const domain = url.replace(/^https?:\/\//, '').split('/')[0];
      return `🌍 Fetching ${domain}...`;
    }
    default:
      return `🔧 Using ${toolName}...`;
  }
}
