// =============================================================================
// Channel Configuration Types
// =============================================================================

export type ChannelType = 'discord' | 'slack' | 'telegram';

/**
 * Discord-specific channel configuration
 */
export interface DiscordChannelConfig {
  type: 'discord';
  /** Discord role name for this agent (e.g., 'dev', 'po') */
  role: string;
  /** Primary channel for this agent */
  primary: string;
  /** Channels the agent can read from */
  canRead: string[];
  /** Channels the agent can write to */
  canWrite: string[];
  /** Discord-specific triggers */
  triggers: {
    onMention: boolean;
    onChannelMessage: boolean;
  };
}

/**
 * Slack-specific channel configuration (future)
 */
export interface SlackChannelConfig {
  type: 'slack';
  /** Slack workspace ID */
  workspaceId: string;
  /** Primary channel */
  primary: string;
  /** Channels the agent can read from */
  canRead: string[];
  /** Channels the agent can write to */
  canWrite: string[];
}

/**
 * Telegram-specific channel configuration (future)
 */
export interface TelegramChannelConfig {
  type: 'telegram';
  /** Telegram chat ID */
  chatId: string;
}

/**
 * Union type for all channel configurations
 */
export type ChannelConfig = DiscordChannelConfig | SlackChannelConfig | TelegramChannelConfig;

// =============================================================================
// Scheduled Task Configuration
// =============================================================================

/**
 * Configuration for scheduled tasks (in agent config.json)
 * These are "system tasks" - git-tracked and read-only at runtime
 */
export interface ScheduledTaskConfig {
  /** Human-readable name for the task */
  name: string;
  /** Cron expression (e.g., "0/15 * * * *" for every 15 minutes) */
  schedule: string;
  /** Full prompt text - no hard-coded lookups! */
  prompt: string;
  /** Whether task is enabled (default: true) */
  enabled?: boolean;
  /** Run immediately on startup (default: true) */
  fireOnStart?: boolean;
}

// =============================================================================
// API Provider Configuration
// =============================================================================

/**
 * Configuration for API provider (Anthropic, OpenRouter, local proxies, etc.)
 * All fields are optional - defaults to Anthropic API with ANTHROPIC_API_KEY
 */
export interface ApiProviderConfig {
  /** Custom API endpoint URL (e.g., "https://openrouter.ai/api") */
  baseUrl?: string;
  /** Environment variable name containing the API key (default: "ANTHROPIC_API_KEY") */
  apiKey?: string;
  /** Additional headers to include in requests */
  headers?: Record<string, string>;
}

// =============================================================================
// Agent Configuration
// =============================================================================

export interface AgentConfig {
  /** Agent identifier (e.g., 'dev', 'po', 'qa') */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Model to use (e.g., 'claude-sonnet-4-20250514') */
  model: string;
  /** Optional path to custom Claude CLI executable */
  claudeExecutable?: string;
  /** Channel configurations (Discord, Slack, etc.) */
  channels: ChannelConfig[];
  /** Scheduled task configurations */
  scheduledTasks?: ScheduledTaskConfig[];
  /** Resource limits */
  limits: {
    maxDailyCostUsd: number;
    cooldownMinutes: number;
  };
  /** Agent to escalate to, or null */
  escalatesTo: string | null;
  /** Optional API provider configuration (defaults to Anthropic) */
  api?: ApiProviderConfig;
  /** Optional runtime configuration */
  runtime?: {
    /** Conversation timeout in milliseconds (default: 300000 = 5 minutes) */
    conversationTimeoutMs?: number;
  };
}

// =============================================================================
// Helper Functions for Channel Access
// =============================================================================

/**
 * Get Discord channel config from agent config
 * @throws Error if no Discord channel configured
 */
export function getDiscordConfig(config: AgentConfig): DiscordChannelConfig {
  const discordChannel = config.channels.find(
    (c): c is DiscordChannelConfig => c.type === 'discord'
  );
  if (!discordChannel) {
    throw new Error(`Agent ${config.name} has no Discord channel configured`);
  }
  return discordChannel;
}

/**
 * Get Discord channel config from agent config, or undefined if not configured
 */
export function getDiscordConfigOrNull(config: AgentConfig): DiscordChannelConfig | undefined {
  return config.channels.find((c): c is DiscordChannelConfig => c.type === 'discord');
}

/**
 * Check if agent has Discord configured
 */
export function hasDiscordChannel(config: AgentConfig): boolean {
  return config.channels.some((c) => c.type === 'discord');
}

// =============================================================================
// Event Types
// =============================================================================

export interface TriggerEvent {
  type: 'discord_mention' | 'discord_message' | 'github_pr_comment' | 'scheduled_task';
  source: string;
  payload: Record<string, unknown>;
  timestamp: Date;
}

export interface AgentContext {
  config: AgentConfig;
  systemPrompt: string;
  conversationHistory: ConversationMessage[];
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface CostTrackerData {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
}

export interface CooldownEntry {
  ticketId: string;
  lastProcessedAt: Date;
  cooldownUntil: Date;
}
