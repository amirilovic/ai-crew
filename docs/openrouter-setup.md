# Using OpenRouter with Agents

This guide explains how to use [OpenRouter](https://openrouter.ai) as an alternative API provider for agents. OpenRouter provides access to 400+ models through a single API, including Claude, GPT, Gemini, DeepSeek, and open-source models.

## Why Use OpenRouter?

- **Cost savings**: Models like DeepSeek V3.2 cost ~98% less than Claude Opus
- **Model variety**: Access to 400+ models from 60+ providers
- **Flexibility**: Different models for different agents (e.g., cheap models for Dev, premium for Architect)
- **Fallback options**: If one provider is down, switch to another

## Prerequisites

1. Create an account at [openrouter.ai](https://openrouter.ai)
2. Generate an API key from your [account settings](https://openrouter.ai/account/keys)

## Configuration

### Step 1: Add API Key to Environment

Add your OpenRouter API key to `.env`:

```env
# Existing Anthropic key (still needed for default agents)
ANTHROPIC_API_KEY=sk-ant-...

# OpenRouter key for agents using OpenRouter
OPENROUTER_API_KEY=sk-or-v1-...
```

### Step 2: Configure Agent to Use OpenRouter

In the agent's `config.json` (e.g., `src/agents/dev/config.json`), add the `api` section:

```json
{
  "name": "dev",
  "model": "anthropic/claude-sonnet-4",
  "api": {
    "baseUrl": "https://openrouter.ai/api",
    "apiKey": "OPENROUTER_API_KEY",
    "headers": {
      "HTTP-Referer": "https://github.com/your-username/ai-crew",
      "X-Title": "Agent Dev Crew"
    }
  }
}
```

### Configuration Options

| Field | Description | Required |
|-------|-------------|----------|
| `baseUrl` | API endpoint URL | Yes |
| `apiKey` | Environment variable name containing the API key | Yes |
| `headers` | Additional HTTP headers (OpenRouter recommends Referer for rankings) | No |

## Model Names

When using OpenRouter, model names use the format `provider/model-name`:

| Model | OpenRouter Name | Notes |
|-------|-----------------|-------|
| Claude Sonnet 4 | `anthropic/claude-sonnet-4` | Same quality, billed through OpenRouter |
| Claude Opus 4.5 | `anthropic/claude-opus-4.5` | Premium reasoning |
| GPT-4o | `openai/gpt-4o` | OpenAI's latest |
| DeepSeek V3 | `deepseek/deepseek-chat` | Very cheap, good quality |
| Gemini 2.0 Flash | `google/gemini-2.0-flash-001` | Fast, cheap |

See [OpenRouter Models](https://openrouter.ai/models) for the full list.

## Example: Mixed Provider Setup

Configure different providers per agent for cost optimization:

**PO** (needs good reasoning, lower volume) - `src/agents/po/config.json`:
```json
{
  "name": "po",
  "model": "claude-sonnet-4-20250514"
  // No api section = uses default Anthropic API
}
```

**Dev** (high volume, code-focused) - `src/agents/dev/config.json`:
```json
{
  "name": "dev",
  "model": "deepseek/deepseek-chat",
  "api": {
    "baseUrl": "https://openrouter.ai/api",
    "apiKey": "OPENROUTER_API_KEY"
  }
}
```

**QA** (verification tasks) - `src/agents/qa/config.json`:
```json
{
  "name": "qa",
  "model": "google/gemini-2.0-flash-001",
  "api": {
    "baseUrl": "https://openrouter.ai/api",
    "apiKey": "OPENROUTER_API_KEY"
  }
}
```

## Cost Comparison

Approximate costs per 1M tokens (input/output):

| Model | Input | Output | Notes |
|-------|-------|--------|-------|
| Claude Opus 4.5 | $15 | $75 | Highest quality |
| Claude Sonnet 4 | $3 | $15 | Good balance |
| GPT-4o | $2.50 | $10 | Strong alternative |
| DeepSeek V3 | $0.14 | $0.28 | ~98% cheaper |
| Gemini Flash | $0.075 | $0.30 | Very fast |

## Verification

After configuration, verify the agent is using OpenRouter:

1. Start the agent: `pm2 restart dev`
2. Check logs: `pm2 logs dev`
3. Look for API calls going to `openrouter.ai`
4. Monitor usage in [OpenRouter Dashboard](https://openrouter.ai/activity)

## Troubleshooting

### "Invalid API key" error

1. Verify `OPENROUTER_API_KEY` is set in `.env`
2. Check the key starts with `sk-or-v1-`
3. Ensure the key has sufficient credits

### Model not responding as expected

1. OpenRouter passes through to the original provider
2. Some features (like extended thinking) may only work with Anthropic's direct API
3. Try switching to `anthropic/claude-*` models for full compatibility

### Rate limiting

OpenRouter has its own rate limits on top of provider limits:
- Monitor your usage in the dashboard
- Consider spreading load across multiple models

## Best Practices

1. **Start with Anthropic models via OpenRouter** (`anthropic/claude-*`) before trying other providers
2. **Use premium models for complex tasks** (architecture decisions, complex debugging)
3. **Use cheaper models for routine tasks** (simple code changes, formatting)
4. **Monitor costs** in both OpenRouter and your internal tracking
5. **Test thoroughly** when switching models - behavior may differ
