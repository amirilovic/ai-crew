---
name: agent-maintenance
description: Use this skill when you need to restart an agent, increase cost limits, check agent status, or perform any agent maintenance tasks. Invoke with "/agent-maintenance" or when asked about restarting agents.
---

# Agent Maintenance Skill

This skill covers how to restart agents, configure them, and manage cost limits using PM2 process manager.

## PM2 Quick Reference

| Task | Command |
|------|---------|
| View all agents | `pm2 status` |
| Restart one agent | `pm2 restart dev` |
| Restart all agents | `pm2 restart all` |
| View logs | `pm2 logs` |
| View one agent's logs | `pm2 logs dev` |
| Stop an agent | `pm2 stop dev` |
| Start all agents | `pm2 start ecosystem.config.js` |

## Agent Configuration

Each agent has a configuration file at `src/agents/<name>/config.json`:

```json
{
  "name": "dev",
  "displayName": "Developer",
  "model": "claude-sonnet-4-20250514",
  "discordRole": "dev",
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
    "cron": [
      {
        "schedule": "*/15 * * * *",
        "task": "check_board"
      }
    ]
  },
  "limits": {
    "maxDailyCostUsd": 100,
    "cooldownMinutes": 0
  },
  "escalatesTo": "po"
}
```

### Key Configuration Fields

| Field | Description |
|-------|-------------|
| `name` | Agent identifier (po, dev, qa, architect) |
| `model` | Claude model to use |
| `discordRole` | Discord role for mentions |
| `channels.primary` | Main channel for posting |
| `triggers.discord.onMention` | Respond when @mentioned |
| `triggers.discord.onChannelMessage` | Respond to all messages |
| `triggers.cron` | Scheduled tasks (cron format) |
| `limits.maxDailyCostUsd` | Daily spending limit |
| `escalatesTo` | Agent to escalate to when blocked |

## Increasing Cost Limits

When an agent hits its daily cost limit, you'll see:
```
Daily cost limit of $X exceeded. Current spend: $Y
```

### Steps to Increase Limit

1. **Edit the agent's config.json**:
   ```bash
   # Example: increase dev's limit from $100 to $200
   # Edit src/agents/dev/config.json
   # Change: "maxDailyCostUsd": 100
   # To:     "maxDailyCostUsd": 200
   ```

2. **Commit and push** (so other agents see the change):
   ```bash
   git add src/agents/dev/config.json
   git commit -m "chore(dev): increase daily cost limit to $200"
   git push origin main
   ```

3. **Rebuild and restart** the affected agent:
   ```bash
   pnpm run build
   pm2 restart dev
   ```

### Recommended Limits

| Agent | Default | Busy Day |
|-------|---------|----------|
| @po | $100 | $150 |
| @dev | $100 | $200 |
| @qa | $50 | $100 |
| @architect | $50 | $100 |

## Restarting an Agent

### Simple Restart (Most Common)

```bash
# Restart a single agent
pm2 restart dev

# Restart all agents
pm2 restart all
```

### Restart After Code Changes

**CRITICAL:** Always rebuild after pulling new code!

```bash
# Pull latest changes
git pull origin main

# Rebuild
pnpm run build

# Restart affected agent(s)
pm2 restart dev
# or restart all
pm2 restart all
```

## Canary Deployment (Recommended for Risky Changes)

For risky code changes (new features, refactors, infrastructure changes), use the canary deployment script. This restarts one agent first to validate the code before rolling out to all agents.

### Why Use Canary Deployment?

- **Prevents total outages** - If new code has a bug, only the canary agent goes down
- **Other agents stay up** - They can fix the issue before restarting themselves
- **Health checks** - Waits 2 minutes to ensure the canary is stable
- **Auto-rollback** - If canary fails, automatically reverts the bad commit

### Canary Deployment Order

1. **architect** (canary) - Least critical, tests new code first
2. **qa** - Needs to be up for PR testing
3. **dev** - Needs to be up for development work
4. **po** - Most critical, coordinates the team (last to deploy)

### Usage

```bash
# Recommended: Full build and canary deploy (with auto-rollback)
./scripts/safe-deploy.sh

# Skip build (use existing dist/)
./scripts/safe-deploy.sh --skip-build

# Disable auto-rollback (manual recovery only)
./scripts/safe-deploy.sh --no-rollback
```

### What Happens

1. **Build phase**: Runs `pnpm run build`
2. **Canary phase**: Restarts architect, waits 2 minutes for health check
3. **If canary healthy**: Continues to qa → dev → po
4. **If canary fails**:
   - **Auto-rollback** (default): Reverts the last commit, rebuilds, restarts canary
   - Sends Discord alert if `DISCORD_WEBHOOK_URL` is set
   - Other agents stay on previous working code

### Auto-Rollback Behavior

When canary fails, the script automatically:
1. Runs `git revert HEAD --no-edit` to undo the bad commit
2. Rebuilds with `pnpm run build`
3. Restarts the canary with the reverted code
4. Posts an alert to Discord (if webhook configured)

**To disable auto-rollback:**
```bash
./scripts/safe-deploy.sh --no-rollback
```

### Discord Alerts

To receive alerts when deployments fail, set the webhook URL:
```bash
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
./scripts/safe-deploy.sh
```

The alert includes:
- Which commit failed
- Whether auto-rollback succeeded
- How to investigate

### When Canary Fails (Without Auto-Rollback)

If auto-rollback is disabled and canary fails:
```
[ERROR] CANARY FAILED! architect did not become healthy within 120s
[ERROR] Aborting deployment. Other agents remain on previous working code.
```

**To investigate:**
```bash
pm2 logs architect --lines 100
```

**To recover manually:**
1. Fix the bug in the code, or
2. Run: `git revert HEAD --no-edit && pnpm run build && pm2 restart architect`
3. Once architect is healthy, run `./scripts/safe-deploy.sh --skip-build`

### Health Check Criteria

An agent is considered "healthy" when:
- Status is "online" in PM2
- Has been running for at least 60 seconds (min_uptime)

### When to Use Canary vs Simple Restart

| Scenario | Use |
|----------|-----|
| New feature deployment | `./scripts/safe-deploy.sh` |
| Infrastructure changes | `./scripts/safe-deploy.sh` |
| Config change only | `pm2 restart <agent>` |
| Single agent issue | `pm2 restart <agent>` |
| Quick hotfix | `pm2 restart all` (if confident) |

### Agent Names

| Agent | PM2 Name |
|-------|----------|
| Product Owner | `po` |
| Developer | `dev` |
| QA (Wolf) | `qa` |
| Architect | `architect` |

## Checking Agent Status

### View All Agents

```bash
pm2 status
```

Output shows:
- Status (online/stopped/errored)
- CPU/Memory usage
- Restarts count
- Uptime

### View Logs

```bash
# All agents (live)
pm2 logs

# Specific agent (live)
pm2 logs dev

# Last 100 lines
pm2 logs dev --lines 100

# Errors only
pm2 logs dev --err
```

### Check Spend Status

Each agent has an MCP tool `get_my_spend` that shows daily usage. Agents can also check:

```bash
cat data/spend/<name>-spend.json
```

## Common Issues

### Agent Not Responding

1. Check status: `pm2 status`
2. Check logs: `pm2 logs <name> --lines 100`
3. Restart: `pm2 restart <name>`

### Agent Context Got Too Large (Session Stuck)

**Cause:** Running commands that produce huge output (thousands of lines) fills up the agent's context window, causing it to become unresponsive.

**How to avoid:**
```bash
# ❌ BAD - dumps thousands of lines
lsof -p 12345

# ✅ GOOD - targeted, minimal output
lsof -p 12345 | grep cwd
lsof -p 12345 | grep "\.log" | head -3

# ❌ BAD - recursive find on large directories
find / -name "*.log"

# ✅ GOOD - scoped search
find ./logs -name "*.log"
```

**Rule:** Always use `| head`, `| tail`, `| grep`, or `| wc -l` to limit output from system commands.

### Agent Hit Cost Limit

1. Increase limit in config.json
2. Commit and push
3. Rebuild and restart: `pnpm run build && pm2 restart <name>`

### Agent Running Stale Code

After any PR merge:
```bash
git pull origin main
pnpm run build
pm2 restart all
```

### Agent in Error State

```bash
# Check what went wrong
pm2 logs <name> --err --lines 50

# Restart
pm2 restart <name>
```

## First-Time Setup (Host Machine)

These steps are done once when setting up a new host:

### 1. Install PM2

```bash
npm install -g pm2
```

### 2. Start All Agents

```bash
cd /path/to/agent-dev-crew
pm2 start ecosystem.config.js
```

### 3. Persist Across Reboots

```bash
pm2 startup
# Follow the instructions it prints
pm2 save
```

### 4. Verify

```bash
pm2 status
# Should show all 4 agents online
```

## Restart Order (When Needed)

For normal restarts, PM2 handles order automatically. For coordinated deployments, use the canary script which follows this order:

1. **Always rebuild first**: `pnpm run build`
2. **Canary (architect)**: First - least critical, catches issues early
3. **QA**: Second - needs to be up for testing
4. **Dev**: Third - needs to be up for development
5. **PO**: Last - most critical, coordinates the team

**Recommended:** Use `./scripts/safe-deploy.sh` for code deployments (handles order + health checks automatically).

⚠️ **Never restart yourself without ensuring at least one other agent is running!**

## Agent Discord Tokens

Each agent has its own Discord bot token in `src/agents/<name>/.env`:

```env
DISCORD_TOKEN=your_bot_token_here
```

These files are gitignored and must be created manually on each machine.

## Ecosystem Configuration

The PM2 ecosystem is defined in `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    { name: 'po', script: 'dist/index.js', env: { AGENT_NAME: 'po' } },
    { name: 'dev', script: 'dist/index.js', env: { AGENT_NAME: 'dev' } },
    { name: 'qa', script: 'dist/index.js', env: { AGENT_NAME: 'qa' } },
    { name: 'architect', script: 'dist/index.js', env: { AGENT_NAME: 'architect' } }
  ]
};
```

To add a new agent, add an entry to this file.
