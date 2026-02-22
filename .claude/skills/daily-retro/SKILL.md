---
name: daily-retro
description: This skill should be used when the user asks to "do a retro", "review team activity", "analyze delivery process", "identify issues from today", "daily retrospective", or when a reminder triggers for the daily retro. Analyzes Discord message history to identify delivery process issues and propose solutions.
---

# Daily Retrospective Skill

Perform a daily retrospective of team activity by analyzing Discord messages and identifying delivery process improvements.

## When to Run

- Triggered by 2am daily reminder
- Manually requested by user ("do a retro", "review today's activity")
- After a particularly busy or problematic day

## Process

### 1. Gather Data

Read Discord messages from the previous day (or specified period):

```
discord_read_channel channel="development" limit=100
```

### 2. Analyze for Issues

Look for these delivery process problems:

**Communication Issues**
- Delayed responses (>1 hour for urgent items)
- Unclear requirements needing multiple clarifications
- Missing context that caused rework
- Agents not notifying each other appropriately

**Workflow Issues**
- Tickets stuck in wrong status
- PRs waiting too long for review
- Work started without proper tickets
- Scope creep or missed acceptance criteria

**Technical Issues**
- Bugs that could have been caught earlier
- Repeated similar bugs (pattern)
- Missing tests or verification steps
- Deployment/infrastructure problems

**Process Issues**
- Tickets not moved through board properly
- Follow-up work not created
- Incomplete handoffs between agents
- Escalations that could have been avoided

### 3. Structure Findings

For each issue identified, document:

```markdown
## Issue: [Brief title]

**Category:** [Communication/Workflow/Technical/Process]

**What happened:**
[Description of the problem]

**Impact:**
[How this affected delivery - time lost, rework, user frustration]

**Root cause:**
[Why this happened - process gap, unclear instructions, missing capability]

**Proposed solution:**
[Specific, actionable improvement]

**Implementation:**
- [ ] Step 1
- [ ] Step 2
```

### 4. Prioritize

Rank issues by:
1. **Frequency** - How often does this happen?
2. **Impact** - How much time/effort is lost?
3. **Fixability** - Can we actually address this?

### 5. Report to Stakeholder

Post findings to Discord:

```markdown
## Daily Retro - [Date]

**Messages analyzed:** X
**Issues identified:** Y
**Top priority:** [Most important issue to address]

### Issues Found

[List issues with brief summaries]

### Proposed Solutions

[For each issue, the proposed fix]

### Recommended Actions

1. [Most important action]
2. [Second action]
3. [Third action]

@aleksandar Please review these findings and let me know which solutions to implement.
```

## Metrics to Track

Over time, track:
- Number of issues per day (should decrease)
- Time from ticket creation to completion
- Number of clarifying questions needed
- Rework rate (tickets reopened or follow-ups created)
- PR review turnaround time

## Example Issues to Watch For

1. **"@dev didn't respond for 2 hours"** → Review trigger configuration
2. **"Had to ask 3 questions before requirements were clear"** → Improve ticket templates
3. **"PR sat in review for 4 hours"** → Add @reviewer pings
4. **"Bug was same root cause as yesterday"** → Create checklist/pattern doc
5. **"Forgot to move ticket to Done"** → Add board hygiene reminders
6. **"Ticket was blocked, nobody noticed"** → Add stale ticket detection

## Self-Improvement Loop

When solutions are approved and implemented:
1. Update relevant agent's CLAUDE.md
2. Add to shared documentation if team-wide
3. Create ticket if code change needed
4. Update this skill with new patterns to watch for

## Journal Entry

After each retro, add to daily journal:

```markdown
## HH:MM - Daily Retro Complete

**Period reviewed:** [Date]
**Issues found:** X
**Top issue:** [Brief description]
**Solutions proposed:** Y
**User response:** [Pending/Approved/Modified]
```
