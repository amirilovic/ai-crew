---
name: discord-reactions
description: Use this skill when communicating on Discord to decide whether to use emoji reactions or messages. Also use when asked about "reaction protocol", "discord efficiency", or how agents should communicate.
---

# Discord Reaction Protocol for Efficient Agent Communication

## Goal
Reduce unnecessary token usage by using emoji reactions for simple acknowledgments and status updates instead of full text messages.

## When to Use Reactions vs. Messages

### Use Reactions For:
- **Acknowledgments**: "I see this", "got it", "understood"
- **Status updates**: "working on it", "done", "blocked"
- **Simple approvals**: "looks good", "approved", "ship it"
- **Quick feedback**: "agree", "disagree", "needs clarification"
- **Task tracking**: "claimed this", "reviewing", "testing"

### Use Messages For:
- **Complex responses**: Explanations, questions, detailed feedback
- **Decisions requiring context**: Why you chose an approach
- **Blocking issues**: Problems that need discussion
- **Clarifying questions**: When requirements are unclear
- **Important updates**: User needs to know details

**Golden Rule**: If it would take more than 5 words to explain, use a message. Otherwise, use a reaction.

---

## Standard Reaction Vocabulary

### Acknowledgment & Status
| Emoji | Meaning | When to Use |
|-------|---------|-------------|
| 👀 | "Seen/Reading" | You've seen the message and are reviewing it |
| 👍 | "Acknowledged/OK" | Simple agreement or acknowledgment |
| ✅ | "Done/Complete" | Task completed successfully |
| ⏳ | "In Progress" | Working on it now |
| 🔄 | "Processing" | Thinking/investigating, will respond soon |
| 🚫 | "Can't do/Blocked" | Unable to proceed (follow up with why) |

### Task Management
| Emoji | Meaning | When to Use |
|-------|---------|-------------|
| 🎯 | "Claimed/Taking this" | You'll handle this task |
| 📋 | "Ticket created" | GitHub issue created |
| 🔍 | "Reviewing" | Code review or investigation in progress |
| 🧪 | "Testing" | Running tests or QA |
| 🚀 | "Deployed/Shipped" | Code merged or deployed |
| 📦 | "Ready for review" | Work complete, needs approval |

### Feedback & Decisions
| Emoji | Meaning | When to Use |
|-------|---------|-------------|
| ✔️ | "Approved" | PR/issue/approach approved |
| ❓ | "Need clarification" | Requires more information (follow up with question) |
| 💡 | "Suggestion/Idea" | Have an alternative approach (explain in message) |
| ⚠️ | "Warning/Concern" | Potential issue (explain in message) |
| 🔥 | "Urgent/Priority" | High priority item |
| 🐛 | "Bug found" | Issue discovered |

### Priority Levels
| Emoji | Meaning | When to Use |
|-------|---------|-------------|
| 🔴 | "P1/Critical" | Blocking issue, needs immediate attention |
| 🟡 | "P2/Important" | Should be done soon |
| 🟢 | "P3/Normal" | Regular priority |
| ⚪ | "P4/Low" | Nice to have |

---

## Communication Patterns

### Pattern 1: Simple Acknowledgment
**Scenario**: User asks you to create a ticket
- Bad: "Got it! I'll create that ticket now."
- Good: React with 👍 (then create ticket)

### Pattern 2: Task Completion
**Scenario**: You finished creating tickets
- Bad: Long message with all details
- Good: React with ✅ + short summary message with links

### Pattern 3: Status Update
**Scenario**: User asks if you're working on something
- Bad: "Yes, I'm currently investigating this issue and will report back."
- Good: React with ⏳ or 🔍 (they know you're on it)

### Pattern 4: Agreement with Other Agent
**Scenario**: Another agent posts analysis you agree with
- Bad: "I agree with @dev's approach here."
- Good: React with ✅ or 👍 on their message

### Pattern 5: Claiming Work
**Scenario**: User posts request, multiple agents could handle it
- Bad: "I can take this one!"
- Good: React with 🎯 (claims it)

### Pattern 6: Escalation Needed
**Scenario**: You're blocked and need help
- Good: React with 🚫 + message explaining blocker

---

## Agent-Specific Patterns

### @po (Product Owner)
- 📋 = Ticket created
- 🎯 = Added to backlog
- ✔️ = Requirements approved
- 📦 = Ready for dev

### @dev (Developer)
- 🎯 = Claimed ticket
- ⏳ = Working on it
- 📦 = PR ready for review
- ✅ = Merged/deployed

### @architect (Architect)
- 🔍 = Researching / Investigating
- 📊 = Analysis in progress
- 💡 = Have recommendation
- ⚠️ = Found concerns

### @qa (QA)
- 👀 = Reviewing/Testing PR
- ✅ = QA Approved
- ❌ = QA Failed
- 🔄 = Re-testing after fixes

---

## Example Conversation (Before vs. After)

### Before (Verbose):
```
User: Create a ticket for dark mode
PO: Got it! I'll create a ticket for dark mode support right now.
PO: Ticket created! Here's the link: github.com/...
User: Thanks!
Dev: I see the ticket, I can work on this.
PO: Great, thanks for taking it!
Dev: Started working on it.
Dev: PR is ready for review.
Reviewer: I'm reviewing it now.
Reviewer: Looks good, approved!
Dev: Thanks, merged it.
```
**Token usage: ~1000 tokens**

### After (Efficient):
```
User: Create a ticket for dark mode
PO: 👍 (reacts immediately)
PO: ✅ Ticket #26 created: github.com/...
Dev: 🎯 (claims ticket)
Dev: ⏳ (starts work)
Dev: 📦 PR #27 ready: github.com/...
Reviewer: 🔍 (reviewing)
Reviewer: ✔️ (approved)
Dev: ✅ Merged
```
**Token usage: ~400 tokens (60% reduction!)**

---

## Using the discord_add_reaction Tool

Agents can now add reactions to Discord messages using the `discord_add_reaction` tool.

### Tool Signature
```typescript
discord_add_reaction({
  channel: string,    // Channel name or ID where the message is
  messageId: string,  // The message ID to react to
  emoji: string       // Unicode emoji (👍) or custom emoji name (:custom:)
})
```

### Example Usage

**Acknowledging a user message:**
```typescript
// User asks for a ticket - acknowledge immediately
discord_add_reaction({
  channel: "development",
  messageId: "1471958558642929757",
  emoji: "👍"
})
```

**Claiming a ticket:**
```typescript
// When picking up a ticket from the board
discord_add_reaction({
  channel: "development",
  messageId: "1471958558642929757",
  emoji: "🎯"
})
```

**Showing work in progress:**
```typescript
// When starting work on a task
discord_add_reaction({
  channel: "development",
  messageId: "1471958558642929757",
  emoji: "⏳"
})
```

**Approving a PR announcement:**
```typescript
// When review is complete
discord_add_reaction({
  channel: "development",
  messageId: "1471958558642929757",
  emoji: "✔️"
})
```

### Getting Message IDs

Message IDs are available in the `discord_read_channel` response:
```json
{
  "messages": [
    {
      "id": "1471958558642929757",  // <-- Use this for messageId
      "author": "username#0",
      "content": "Create a ticket for dark mode"
    }
  ]
}
```

### Multiple Reactions

You can add multiple reactions to the same message by calling the tool multiple times:
```typescript
// Show you saw it
discord_add_reaction({ channel: "development", messageId: "123", emoji: "👀" })
// Then mark as complete
discord_add_reaction({ channel: "development", messageId: "123", emoji: "✅" })
```

---

## Implementation Guidelines

### For Agents:
1. **React first, respond if needed**: If simple acknowledgment suffices, just react
2. **Use reactions for status**: Don't say "I'm working on it", react with ⏳
3. **Combine reactions + brief messages**: React ✅ + short summary with links
4. **React to other agents**: Show agreement/acknowledgment with reactions
5. **Follow up complex reactions with details**: 🚫 or ⚠️ always needs explanation

### For Users:
1. **React to acknowledge agent messages**: Let agents know you saw it
2. **Use reactions for approval**: ✔️ instead of "looks good"
3. **Use reactions to prioritize**: 🔴/🟡/🟢 to indicate urgency
4. **Expect reactions from agents**: Silence + 👀 reaction means "I'm on it"

---

## Benefits

- **60-80% token reduction** on simple acknowledgments
- **Faster communication** - no waiting for full message generation
- **Clearer status tracking** - visual indicators at a glance
- **Less cognitive load** - skim reactions instead of reading paragraphs
- **Cost savings** - fewer API calls, lower token usage
