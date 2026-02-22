# Agent Configuration Reference

This document describes all configuration options available for agents in `src/agents/{agent}/config.json`.

## Complete Example

```json
{
  "name": "dev",
  "displayName": "Developer",
  "model": "claude-sonnet-4-20250514",
  "claudeExecutable": "/usr/local/bin/claude-epic",
  "api": {
    "baseUrl": "https://openrouter.ai/api",
    "apiKey": "OPENROUTER_API_KEY",
    "headers": {
      "HTTP-Referer": "https://github.com/your-username/ai-crew",
      "X-Title": "Agent Dev Crew"
    }
  },
  "channels": [
    {
      "type": "discord",
      "role": "dev",
      "primary": "dev-chat",
      "canRead": ["dev-chat", "development"],
      "canWrite": ["dev-chat", "development"],
      "triggers": {
        "onMention": true,
        "onChannelMessage": false
      }
    }
  ],
  "cron": [
    {
      "schedule": "*/5 * * * *",
      "task": "check_board"
    },
    {
      "schedule": "0 9 * * *",
      "task": "daily_standup",
      "prompt": "Post your daily standup update to #development"
    }
  ],
  "limits": {
    "maxDailyCostUsd": 50,
    "cooldownMinutes": 5
  },
  "escalatesTo": "po"
}
```

## Core Fields

### `name` (required)
Agent identifier used internally and for PM2 process naming.

```json
"name": "dev"
```

### `displayName` (required)
Human-readable name shown in logs and Discord messages.

```json
"displayName": "Developer"
```

### `model` (required)
AI model to use. For Anthropic direct:
- `claude-sonnet-4-20250514` - Fast, cost-effective
- `claude-opus-4-20250514` - Most capable

For OpenRouter, use provider prefix:
- `anthropic/claude-sonnet-4`
- `deepseek/deepseek-chat-v3-0324`
- `google/gemini-2.0-flash-001`

```json
"model": "claude-sonnet-4-20250514"
```

### `claudeExecutable` (optional)
Path to custom Claude CLI executable. Useful when multiple CLI versions are installed.

```json
"claudeExecutable": "/usr/local/bin/claude-epic"
```

If not specified, uses whichever `claude` is first in `$PATH`.

### `escalatesTo` (required)
Agent name to escalate issues to, or `null` for top-level agents.

```json
"escalatesTo": "po"
```

## API Provider Configuration

The `api` section configures which API endpoint to use. All fields are optional - omit entirely to use Anthropic's default API.

### `api.baseUrl`
Custom API endpoint URL.

```json
"api": {
  "baseUrl": "https://openrouter.ai/api"
}
```

Common values:
- `https://openrouter.ai/api` - OpenRouter
- `https://api.anthropic.com` - Anthropic (default)
- Custom proxy URLs

### `api.apiKey`
Environment variable name containing the API key. Default: `ANTHROPIC_API_KEY`

```json
"api": {
  "apiKey": "OPENROUTER_API_KEY"
}
```

### `api.headers`
Additional HTTP headers to include in API requests.

```json
"api": {
  "headers": {
    "HTTP-Referer": "https://your-site.com",
    "X-Title": "Your App Name"
  }
}
```

OpenRouter recommends setting `HTTP-Referer` for usage tracking.

## Discord Channel Configuration

The `channels` array supports multiple channel types. Currently only Discord is implemented.

### Discord Channel Fields

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"discord"` | Channel type identifier |
| `role` | string | Discord role name for this agent (e.g., `"dev"`) |
| `primary` | string | Primary channel for this agent |
| `canRead` | string[] | Channels the agent can read from |
| `canWrite` | string[] | Channels the agent can write to |
| `triggers.onMention` | boolean | Respond when @mentioned |
| `triggers.onChannelMessage` | boolean | Respond to all messages in primary channel |

### Example Discord Config

```json
"channels": [
  {
    "type": "discord",
    "role": "dev",
    "primary": "dev-chat",
    "canRead": ["dev-chat", "development", "incidents"],
    "canWrite": ["dev-chat", "development"],
    "triggers": {
      "onMention": true,
      "onChannelMessage": false
    }
  }
]
```

### Trigger Behavior

- **onMention: true** - Agent responds when its role is @mentioned
- **onChannelMessage: true** - Agent responds to ALL messages in `primary` channel (unless another agent is @mentioned)

Typically:
- PO: `onMention: true, onChannelMessage: true` (responds to everything in primary)
- Dev/QA: `onMention: true, onChannelMessage: false` (only responds when asked)

## Cron Configuration

The `cron` array defines scheduled tasks.

### Cron Fields

| Field | Type | Description |
|-------|------|-------------|
| `schedule` | string | Cron expression (e.g., `"*/5 * * * *"`) |
| `task` | string | Task identifier passed to agent prompt |
| `prompt` | string | Optional custom prompt template |

### Example Cron Config

```json
"cron": [
  {
    "schedule": "*/15 * * * *",
    "task": "check_board"
  },
  {
    "schedule": "*/5 * * * *",
    "task": "check_prs"
  },
  {
    "schedule": "0 9 * * 1-5",
    "task": "daily_standup",
    "prompt": "Post your daily standup update summarizing yesterday's work and today's plan"
  }
]
```

### Cron Expression Reference

| Expression | Meaning |
|------------|---------|
| `*/5 * * * *` | Every 5 minutes |
| `*/15 * * * *` | Every 15 minutes |
| `0 * * * *` | Every hour |
| `0 9 * * *` | Daily at 9:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `0 0 * * 0` | Sundays at midnight |

## Resource Limits

The `limits` section controls cost and rate limiting.

### `limits.maxDailyCostUsd`
Maximum daily API cost in USD. Agent stops responding when limit is reached.

```json
"limits": {
  "maxDailyCostUsd": 50
}
```

### `limits.cooldownMinutes`
Minimum time between processing the same ticket/issue.

```json
"limits": {
  "cooldownMinutes": 5
}
```

## Environment Variables

These environment variables are used by agents:

| Variable | Description | Required |
|----------|-------------|----------|
| `DISCORD_TOKEN` | Discord bot token | Yes |
| `DISCORD_GUILD_ID` | Discord server ID | Yes |
| `ANTHROPIC_API_KEY` | Anthropic API key (default) | Yes* |
| `OPENROUTER_API_KEY` | OpenRouter API key | If using OpenRouter |
| `MAX_DAILY_COST_USD` | Global daily cost limit | Yes |
| `AGENT_NAME` | Which agent to run | Yes (runtime) |
| `AUTO_UPDATE_ENABLED` | Enable self-updates | No (default: true) |

*Not required if all agents use custom `api.apiKey` config.

## Agent-Specific Defaults

### PO (Product Owner)
```json
{
  "model": "claude-sonnet-4-20250514",
  "triggers": { "onMention": true, "onChannelMessage": true },
  "escalatesTo": null
}
```

### Dev (Developer)
```json
{
  "model": "claude-sonnet-4-20250514",
  "triggers": { "onMention": true, "onChannelMessage": false },
  "escalatesTo": "po"
}
```

### QA
```json
{
  "model": "claude-sonnet-4-20250514",
  "triggers": { "onMention": true, "onChannelMessage": false },
  "escalatesTo": "po"
}
```

### Architect
```json
{
  "model": "claude-opus-4-20250514",
  "triggers": { "onMention": true, "onChannelMessage": false },
  "escalatesTo": "po"
}
```

## Validation

Config files are validated at startup. Common errors:

- **Missing required field**: `name`, `displayName`, `model`, `channels`, `cron`, `limits`, `escalatesTo`
- **Invalid cron expression**: Check syntax at [crontab.guru](https://crontab.guru)
- **Unknown channel type**: Only `discord` is currently supported
- **Invalid API key env var**: The specified environment variable must be set
