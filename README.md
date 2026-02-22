# Agent Dev Crew

[![CI](https://github.com/amirilovic/agent-dev-crew/actions/workflows/ci.yml/badge.svg)](https://github.com/amirilovic/agent-dev-crew/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-30%25%20min-brightgreen)](https://github.com/amirilovic/agent-dev-crew)

A system of autonomous AI agents (Product Owner, Developer, QA, Architect) that collaborate via Discord and GitHub. Built on the Claude Agent SDK.

## Overview

Modern LLMs can self-organize and collaborate effectively when given access to standard human collaboration tools (chat, kanban boards, code repos) without requiring explicit workflow orchestration code.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   │
│   │    PO    │   │   Dev    │   │    QA    │   │ Architect│   │
│   │  Agent   │   │  Agent   │   │  Agent   │   │   Agent  │   │
│   └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘   │
│        │              │              │              │          │
│        └──────────────┴──────────────┴──────────────┘          │
│                           │                                     │
│                    ┌──────┴──────┐                              │
│                    │   Discord   │  Communication               │
│                    │   GitHub    │  Work Tracking               │
│                    └─────────────┘                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- PM2 for process management (`npm install -g pm2`)
- GitHub CLI (`brew install gh` or [cli.github.com](https://cli.github.com/))
- Discord bot token and server

### Installation

```bash
# Clone the repository
git clone https://github.com/amirilovic/agent-dev-crew.git
cd agent-dev-crew

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
# See "Configuration" section below
```

### Configuration

Create a `.env` file with:

```env
# Discord Configuration
DISCORD_TOKEN=your-discord-bot-token
DISCORD_GUILD_ID=your-guild-id

# Cost Limits
MAX_DAILY_COST_USD=50.00
```

### Build & Run

```bash
# Build TypeScript
pnpm build

# Start all agents with PM2
pm2 start ecosystem.config.cjs

# View status
pm2 status

# View logs
pm2 logs

# Restart all agents
pm2 restart all
```

## Agents

| Agent | Role | Discord Role | Primary Channel |
|-------|------|--------------|-----------------|
| **PO** | Product Owner - Creates tickets, manages backlog, answers questions | `@po` | `#development` |
| **Dev** | Developer - Implements features, creates PRs | `@dev` | `#dev-chat` |
| **QA** | QA Engineer - Tests PRs, verifies functionality | `@qa` | `#dev-chat` |
| **Architect** | Technical Lead - Research, architecture decisions | `@architect` | `#development` |

### Escalation Flow

```
Dev ──────┐
          │
QA  ──────┼──► PO ──────► Human (@aleksandar)
          │
Architect─┘
```

Only PO escalates to the human. All other agents escalate to PO.

## How It Works

### Triggers

Agents respond to:
- **Discord mentions**: `@dev can you fix this bug?`
- **Cron schedules**: Periodic checks for work
- **GitHub events**: PR reviews, issue assignments (via polling)

### Workflow Example

1. Human posts in `#development`: "We need a login feature"
2. **PO** creates a GitHub issue with acceptance criteria
3. **PO** moves issue to "Ready for Dev"
4. **Dev** picks up the ticket, creates a branch, implements
5. **Dev** creates PR, moves ticket to "In Review"
6. **QA** tests the PR, approves or requests changes
7. PR is merged, ticket moves to "Done"

## Project Structure

```
agent-dev-crew/
├── src/
│   ├── agents/              # Agent configurations
│   │   ├── po/CLAUDE.md     # PO instructions
│   │   ├── dev/CLAUDE.md    # Dev instructions
│   │   ├── qa/CLAUDE.md     # QA instructions
│   │   └── architect/CLAUDE.md
│   ├── shared/
│   │   ├── runner/          # Agent execution loop
│   │   ├── tools/           # Discord tools
│   │   ├── guardrails/      # Cost tracking, cooldowns
│   │   └── auto-update/     # Self-update mechanism
│   └── index.ts             # Entry point
├── docs/                    # Documentation
├── data/                    # Shared state, journals
├── ecosystem.config.cjs     # PM2 configuration
└── package.json
```

## PM2 Management

```bash
# Start all agents
pm2 start ecosystem.config.cjs

# Restart specific agent
pm2 restart dev

# View logs
pm2 logs dev

# Stop all
pm2 stop all

# Set up auto-start on boot
pm2 startup
pm2 save
```

## Documentation

### Setup Guides
- [Discord Setup](docs/discord-setup.md) - Create bot, configure server
- [GitHub Setup](docs/github-setup.md) - Configure repository, project board
- [OpenRouter Setup](docs/openrouter-setup.md) - Use alternative AI providers (OpenRouter, DeepSeek, etc.)

### Development
- [Testing Agents](docs/testing-agents.md) - Testing strategy and guidelines
- [Creating Skills](docs/creating-skills.md) - How to add agent capabilities
- [Discord File Tools](docs/discord-file-tools.md) - File attachments in Discord

### Operations
- [Auto-Update](docs/auto-update.md) - How agents self-update

### Reference
- [Configuration Reference](docs/configuration-reference.md) - All agent config.json options
- [PRD.md](PRD.md) - Full product requirements document

## Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# With coverage
pnpm test:coverage
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DISCORD_TOKEN` | Discord bot token | Yes |
| `DISCORD_GUILD_ID` | Discord server ID | Yes |
| `MAX_DAILY_COST_USD` | Daily API cost limit | Yes |
| `AGENT_NAME` | Which agent to run (po/dev/qa/architect) | Yes (at runtime) |
| `AUTO_UPDATE_ENABLED` | Enable self-updates (default: true) | No |

## Tech Stack

- **Runtime**: Node.js 20+ / TypeScript
- **Agent Framework**: `@anthropic-ai/claude-agent-sdk`
- **Communication**: Discord (discord.js)
- **Work Tracking**: GitHub Projects API
- **Process Management**: PM2
- **Testing**: Vitest

## Contributing

1. Create a feature branch
2. Make changes
3. Run tests: `pnpm test`
4. Create a PR

## License

MIT
