# How to Create Claude Code Skills

This guide explains how to create proper Claude Code skills that all agents can use.

## What is a Skill?

A skill extends what Claude can do. It's a `SKILL.md` file with instructions that Claude follows when the skill is relevant. Skills can be invoked:
- **Automatically** by Claude when the task matches the skill's description
- **Manually** by typing `/skill-name`

## Skill Location

Skills are stored in the `.claude/skills/` directory:

```
.claude/
└── skills/
    └── skill-name/
        └── SKILL.md         # Required - main instructions
        └── examples/        # Optional - example files
        └── scripts/         # Optional - helper scripts
```

**Where to put skills:**
- **Project skills**: `.claude/skills/` in the repo (shared with team via git)
- **Personal skills**: `~/.claude/skills/` (only for you)

For agent-dev-crew, put skills in **project** `.claude/skills/` so all agents benefit.

## SKILL.md Format

Every skill needs a `SKILL.md` file with two parts:

### 1. YAML Frontmatter (Required)

```yaml
---
name: skill-name
description: When Claude should use this skill - include trigger phrases and keywords
---
```

### 2. Markdown Content (Required)

Instructions Claude follows when the skill is active.

## Complete Example

```yaml
---
name: browser-automation
description: This skill should be used when the user asks to "test in browser", "open a webpage", "take a screenshot", "fill a form", "E2E test", or needs to interact with a web application.
---

# Browser Automation

Use `agent-browser` CLI for web automation tasks.

## Quick Start

\`\`\`bash
agent-browser open https://example.com
agent-browser screenshot /tmp/screenshot.png
\`\`\`

## Common Workflows

### Test a form
\`\`\`bash
agent-browser open https://example.com/signup
agent-browser snapshot -i                  # Get form elements
agent-browser fill @e1 "test@example.com"  # Fill email
agent-browser click @e2                    # Submit
\`\`\`
```

## Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Skill identifier (lowercase, hyphens allowed) |
| `description` | Yes | **Critical** - tells Claude when to use this skill |
| `disable-model-invocation` | No | Set `true` to only allow manual invocation |
| `allowed-tools` | No | Restrict which tools Claude can use |
| `context` | No | Set `fork` to run in isolated subagent |

## Writing Good Descriptions

The `description` field is **crucial** - it tells Claude when to activate the skill.

**Good description:**
```yaml
description: This skill should be used when the user asks to "test in browser", "open a webpage", "take a screenshot", "fill a form", "E2E test", "verify in browser", or needs to interact with a web application.
```

**Bad description:**
```yaml
description: Browser stuff
```

**Include:**
- Specific trigger phrases users might say
- Keywords that indicate relevance
- Task types the skill handles

## Creating a New Skill - Checklist

1. **Create directory**: `mkdir -p .claude/skills/skill-name/`
2. **Create SKILL.md** with:
   - [ ] YAML frontmatter with `name` and `description`
   - [ ] Clear instructions for Claude
   - [ ] Examples and code snippets
   - [ ] When to use / when not to use
3. **Test the skill**:
   - Ask something matching the description
   - Or invoke with `/skill-name`
4. **Commit to git** so all agents benefit

## Skills vs data/shared/ Documentation

| Feature | `.claude/skills/` | `data/shared/` |
|---------|-------------------|----------------|
| Claude auto-loads | Yes (via description) | No |
| Invocable via /name | Yes | No |
| For structured instructions | Yes | No |
| For reference docs | No | Yes |
| For decision logs | No | Yes |

**Rule of thumb:**
- **Skill** = Instructions Claude should follow automatically for specific tasks
- **data/shared/** = Reference documentation agents might need to read

## Current Skills

Skills in `.claude/skills/`:
- `browser-automation` - E2E testing with `agent-browser` CLI

## When to Create a New Skill

Create a skill when:
- Multiple agents need the same capability
- There's a specific tool/workflow that should be triggered automatically
- You want `/command` style invocation

Don't create a skill for:
- Reference documentation (use `data/shared/`)
- Decision logs (use `data/shared/decisions-log.md`)
- Agent-specific instructions (use agent's CLAUDE.md)

## References

- [Official Claude Code Skills Docs](https://code.claude.com/docs/en/skills)
- [Agent Skills Open Standard](https://agentskills.io)
