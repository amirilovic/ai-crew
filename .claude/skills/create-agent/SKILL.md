---
name: create-agent
description: Use this skill when asked to "create a new agent", "deploy a new agent", "add an agent", or set up a new team member. Also when someone asks "how do I create an agent" or needs to configure agent triggers, channels, or escalation.
---

# Skill: Create New Agent

Use this skill when asked to create a new agent for the team.

## Overview

Creating a new agent requires:
1. Understanding the agent's purpose and responsibilities
2. Gathering necessary configuration details
3. Creating the agent files (config.json + CLAUDE.md)
4. **User creates Discord role** (only step they do)
5. Building the project
6. Starting the agent
7. Updating team-agents.md
8. Announcing the new agent to the team

## Questions to Ask the User

Before creating an agent, I need to gather this information:

### Required Information

| Question | Why I Need It | Example |
|----------|---------------|---------|
| **What is the agent's name?** | Used for folder name, AGENT_NAME env var, Discord role | `qa`, `docs`, `devops` |
| **What is the agent's role/purpose?** | Core of CLAUDE.md persona | "Run tests and report quality issues" |
| **What are its main responsibilities?** | Defines what the agent should/shouldn't do | "Monitor test failures, report coverage" |
| **Which Discord channels should it access?** | Configures `channels` in config.json | Read: development, qa-alerts. Write: development |
| **What triggers should wake it up?** | Configures `triggers` in config.json | On mention, every 30 mins cron |
| **Who does it escalate to?** | Configures `escalatesTo` | `po` or `dev` |

### Optional Information (with defaults)

| Question | Default | When to Ask |
|----------|---------|-------------|
| **Claude model?** | `claude-sonnet-4-20250514` | Only if they want a different model |
| **Max turns per run?** | 50 | Only if high-volume agent |
| **Max daily cost?** | $25 | Only if budget concerns |
| **Cooldown minutes?** | 0 | Only if rate limiting needed |
| **Display name?** | Capitalized agent name | Usually fine to derive |

## Information I Can Derive

Don't ask for these - I can figure them out:

- **Folder path**: `src/agents/<name>/`
- **Discord role name**: Usually same as agent name
- **Model**: Default to sonnet unless specified
- **Cron schedule syntax**: I know cron, just ask "how often"
- **CLAUDE.md structure**: I know the pattern from existing agents

## Checklist Before Creating

Before writing any files, confirm:

- [ ] Agent name is lowercase, no spaces (e.g., `qa`, `devops`, `docs-writer`)
- [ ] Purpose is clear and distinct from existing agents
- [ ] Responsibilities don't overlap significantly with existing agents (see `data/shared/team-agents.md`)
- [ ] Discord channel(s) exist or user will create them
- [ ] User will create Discord role (this is the ONLY thing they need to do)

## File Templates

### config.json Template

```json
{
  "name": "<agent-name>",
  "displayName": "<Display Name>",
  "model": "claude-sonnet-4-20250514",
  "discordRole": "<agent-name>",
  "channels": {
    "primary": "development",
    "canRead": ["development"],
    "canWrite": ["development"]
  },
  "triggers": {
    "discord": {
      "onMention": true,
      "onChannelMessage": false
    },
    "github": {
      "onPrReviewComment": false
    },
    "cron": []
  },
  "limits": {
    "maxTurnsPerRun": 50,
    "maxDailyCostUsd": 25,
    "cooldownMinutes": 0
  },
  "escalatesTo": "po"
}
```

### CLAUDE.md Structure

```markdown
# <Display Name> Agent (<Short Name>)

You are the <Role> agent for this development team. Your role is to <primary purpose>.

## Your Responsibilities

1. **<Responsibility 1>**: <Description>
2. **<Responsibility 2>**: <Description>
3. **<Responsibility 3>**: <Description>

## Communication Style

- <How to communicate with team>
- <Tone and formality>
- <When to be proactive vs reactive>

## Workflow

<Step-by-step process the agent follows>

1. When triggered, <first action>
2. <Second action>
3. <Continue as needed>

## Available Tools

### Discord Tools
- `discord_read_channel`: Read messages from a channel
- `discord_post_message`: Post messages to communicate with the team
- `discord_send_file`: Send files/images to Discord
- `discord_transcribe_voice`: Transcribe voice messages
- `discord_send_voice`: Send voice messages (TTS)

### GitHub Tools (via Bash + gh CLI)
- Create/view/comment on issues
- Create/view/merge PRs
- Manage project board

### Other Tools
- `Bash`: Run shell commands
- `Read/Write/Edit`: File operations
- `Grep/Glob`: Search codebase
- `WebFetch/WebSearch`: Web access

## Escalation

If you encounter <situation>, escalate to @<agent> in Discord with:
- Clear explanation of the issue
- What you've tried
- What you need help with

## Self-Improvement

When you discover a better way to do your job, update your own CLAUDE.md.

## Knowledge Management

### Daily Journal
Maintain a journal at `data/journals/<name>/YYYY-MM-DD.md` to track:
- Important decisions
- Learnings
- Context for future sessions

### Shared Documentation
Read and update shared docs in `data/shared/` when relevant.
```

## Post-Creation Steps (I do these, not the user)

After creating the agent files:

### 1. Ask user to create Discord role
```
Please create a Discord role named `<agent-name>` (make it mentionable).
Let me know when it's ready and I'll start the agent.
```

### 2. Create journal folder
```bash
mkdir -p data/journals/<agent-name>
```

### 3. Build the project
```bash
cd . && pnpm run build
```

### 4. Start the agent
```bash
nohup env AGENT_NAME=<name> node dist/index.js > /dev/null 2>&1 &
```

### 5. Verify agent is running
```bash
ps aux | grep "node dist/index.js" | grep -v grep
```

### 6. Update team-agents.md
Add the new agent to `data/shared/team-agents.md` following the existing format.

### 7. Announce in Discord
```
New agent deployed: @<agent-name>

**Role**: <brief description>
**Mention for**: <when to use>

See `data/shared/team-agents.md` for full details.
```

## Example Conversation Flow

```
User: Create a QA agent that monitors test results

Me: I'll create a QA agent for you! Let me gather a few details:

1. **Agent name**: `qa` (lowercase, for folders/env var) - is this good?
2. **Main responsibilities** - I'm thinking:
   - Monitor test results from CI
   - Report test failures in Discord
   - Track test coverage trends
   - Alert on quality regressions
   Does this match what you need?
3. **Discord channels**: Should it post to `development` or a separate `qa-alerts` channel?
4. **Triggers**:
   - Respond to @mentions? (yes/no)
   - Check periodically? If so, how often? (e.g., every 15 mins)
5. **Escalation**: Should it escalate issues to @po or @dev?

User: [provides answers]

Me: Got it! Creating the agent now...
[Creates config.json]
[Creates CLAUDE.md]
[Creates journal folder]

Please create a Discord role named `qa` (make it mentionable). Let me know when ready!

User: Done

Me: [Builds project]
[Starts agent]
[Verifies running]
[Updates team-agents.md]

@qa agent is live! See `data/shared/team-agents.md` for details.
```

## Common Agent Types

Reference for suggesting responsibilities:

| Type | Purpose | Key Responsibilities |
|------|---------|---------------------|
| QA/Test | Quality assurance | Run tests, report failures, track coverage |
| Docs | Documentation | Update docs, check for outdated content |
| DevOps | Infrastructure | Monitor deploys, manage infra, alerts |
| Security | Security scanning | Run security scans, report vulnerabilities |
| Support | User support | Triage user issues, escalate bugs |
