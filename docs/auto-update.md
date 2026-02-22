# Auto-Update Mechanism

This document describes how agents automatically update when the main branch changes.

## Overview

Agents can automatically detect and apply updates from the main branch. This ensures agents always run the latest instructions and code without manual intervention.

## How It Works

### Update Detection
1. On startup, agents check for updates from `origin/main`
2. Every 10 minutes, agents perform periodic update checks
3. If local HEAD differs from remote HEAD, an update is available

### Update Process
```
1. git fetch origin
2. Compare local HEAD vs origin/main
3. If different and no local changes:
   a. Store current commit (for rollback)
   b. git pull origin main
   c. Notify via Discord
4. Continue normal operation
```

### Safety Checks
- **No local changes**: Updates only apply if `git status --porcelain` is empty
- **Rollback available**: Previous commit is stored for potential rollback
- **Non-blocking**: Update failures don't crash the agent

## Configuration

### Environment Variables

```env
# Disable auto-updates (default: true)
AUTO_UPDATE_ENABLED=false
```

### Default Settings
- Update check interval: 10 minutes
- Branch: `main`
- Discord notifications: Enabled

## Discord Notifications

When an update is applied, agents post to #dev-chat:

```
🔄 **@dev updated**
`abc1234` → `def5678`

**Changes:**
• abc1234 feat: Add new feature
• bcd2345 fix: Bug fix
```

## Rollback

If an update causes issues, the agent can rollback to the previous commit:

```typescript
import { rollback } from './shared/auto-update/index.js';

// Rollback to previous commit
await rollback();
```

**Note:** Rollback is currently manual. Automatic rollback on error may be added in future versions.

## API Reference

### `checkAndApplyUpdate(config?)`

Main function to check and apply updates.

```typescript
const result = await checkAndApplyUpdate({
  enabled: true,     // Enable/disable updates
  branch: 'main',    // Branch to pull from
});

// Result:
{
  updated: boolean,
  previousCommit: string | null,
  currentCommit: string,
  error?: string,
  changes?: string[],  // Commit summaries
}
```

### `checkForUpdate(branch?)`

Check if updates are available without applying them.

```typescript
const { updateAvailable, localCommit, remoteCommit } = await checkForUpdate();
```

### `rollback()`

Rollback to the previous commit (if stored).

```typescript
const success = await rollback();
```

### `formatUpdateNotification(result, agentName)`

Format update result for Discord notification.

```typescript
const message = formatUpdateNotification(result, 'dev');
// "🔄 **@dev updated**\n`abc1234` → `def5678`"
```

## Best Practices

1. **Don't make local changes** to tracked files in the running agent directory
2. **Test updates** in development before pushing to main
3. **Watch #dev-chat** for update notifications
4. **Check logs** if agents behave unexpectedly after an update

## Troubleshooting

### Updates Not Applying

1. Check if auto-update is enabled: `AUTO_UPDATE_ENABLED` env var
2. Check for local changes: `git status`
3. Check logs for errors

### Update Fails with Local Changes

The agent won't update if there are uncommitted changes. Either:
- Commit or stash the changes
- Or reset: `git checkout -- .`

### Need to Pin to Specific Version

Currently not supported. As a workaround:
1. Set `AUTO_UPDATE_ENABLED=false`
2. Manually checkout the desired commit

## Future Improvements

- [ ] Automatic rollback on startup failure
- [ ] Version pinning support
- [ ] Staged rollout (update one agent, verify, then others)
- [ ] Update scheduling (only during low-activity periods)
- [ ] Webhook support for instant updates
