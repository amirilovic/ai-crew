# Architecture Plan: Generic Agent Runtime

## Vision

Transform the current Discord-specific agent framework into a **generic agent runtime** where:

- The core loop knows nothing about Discord, Slack, Telegram, or WhatsApp
- Channel integrations are pluggable adapters
- An agent's job (developer, QA, PO, personal assistant) is defined entirely by **config + instructions + skills + tools** — not by code changes
- Cron/scheduling is a first-class tool, not framework plumbing

---

## Current Architecture (What We Have)

```
index.ts
  → loadAgent(name)
      → reads config.json, CLAUDE.md, tools.ts (dead code)
      → creates CostTracker, CooldownManager, TriggerManager, ReminderManager
  → startAgent(agent)
      → TriggerManager.start()
          → sets up cron jobs (node-cron)
          → sets up Discord event listeners (discord.js)
          → catches up on missed Discord messages
      → ReminderManager.start()
      → handleTrigger(event)
          → buildPromptFromTrigger(event)  ← hardcoded agent-specific prompts
          → runAgentLoop(context, prompt)
              → creates MCP servers with Discord tools (hardcoded)
              → creates MCP servers with Reminder tools
              → query() with Claude SDK
```

**Problems:**
1. `TriggerManager` is 50% Discord-specific code (event listeners, catch-up, role detection)
2. `loop.ts` hardcodes Discord MCP tools (~350 lines of Discord tool definitions)
3. `buildPromptFromTrigger()` hardcodes agent-specific cron prompts
4. Adding Telegram/Slack means rewriting TriggerManager and loop.ts
5. `src/shared/tools/` is an entire dead tool system (~440 lines)
6. Agent identity (dev/qa/po) leaks into the shared runtime

---

## Proposed Architecture (What We Want)

```
                         ┌─────────────────────────┐
                         │      Agent Config        │
                         │  config.json + CLAUDE.md │
                         │  + skills/ + tools/      │
                         └────────────┬────────────┘
                                      │
                                      ▼
┌──────────────┐         ┌─────────────────────────┐
│   Channels   │────────▶│     Agent Runtime        │
│              │         │                          │
│ ┌──────────┐ │  events │  ┌────────────────────┐  │
│ │ Discord  │─┼────────▶│  │  Event Router      │  │
│ └──────────┘ │         │  │  (queue + dispatch) │  │
│ ┌──────────┐ │         │  └────────┬───────────┘  │
│ │ Telegram │─┼────────▶│           │              │
│ └──────────┘ │         │           ▼              │
│ ┌──────────┐ │         │  ┌────────────────────┐  │
│ │  Slack   │─┼────────▶│  │  Agent Loop        │  │
│ └──────────┘ │         │  │  (Claude SDK query) │  │
│ ┌──────────┐ │         │  └────────┬───────────┘  │
│ │ WhatsApp │─┼────────▶│           │              │
│ └──────────┘ │         │           │ uses         │
│ ┌──────────┐ │         │           ▼              │
│ │   Cron   │─┼────────▶│  ┌────────────────────┐  │
│ └──────────┘ │         │  │  MCP Tool Registry  │  │
│              │◀────────┼──│  (auto-generated    │  │
│              │  actions │  │   from adapters)    │  │
└──────────────┘         │  └────────────────────┘  │
                         │                          │
                         │  ┌────────────────────┐  │
                         │  │  Guardrails         │  │
                         │  │  (cost, cooldown,   │  │
                         │  │   session)          │  │
                         │  └────────────────────┘  │
                         └─────────────────────────┘
```

---

## Layer 1: Channel Adapter Interface

The key abstraction. Every messaging platform implements this interface:

```typescript
// src/core/channels/types.ts

interface ChannelAdapter {
  /** Unique adapter type identifier */
  readonly type: string;  // "discord", "telegram", "slack", "whatsapp"

  /** Connect to the platform */
  connect(): Promise<void>;

  /** Disconnect gracefully */
  disconnect(): Promise<void>;

  /** Subscribe to incoming messages. Adapter calls handler when messages arrive. */
  onMessage(handler: IncomingMessageHandler): void;

  /** Read message history from a channel */
  readMessages(channel: string, options?: ReadOptions): Promise<Message[]>;

  /** Send a text message */
  sendMessage(channel: string, content: string, options?: SendOptions): Promise<SentMessage>;

  /** Send a file/attachment */
  sendFile(channel: string, filePath: string, options?: SendFileOptions): Promise<SentMessage>;

  /** Add a reaction (if platform supports it, no-op otherwise) */
  addReaction?(channel: string, messageId: string, emoji: string): Promise<void>;

  /** Platform-specific extras (voice, transcription, etc.) */
  getExtensions?(): ChannelExtension[];

  /** Generate MCP tools for this adapter (auto-called by runtime) */
  createTools(): McpTool[];
}

interface Message {
  id: string;
  channel: string;
  author: { id: string; name: string; isBot: boolean };
  content: string;
  timestamp: Date;
  attachments?: Attachment[];
  metadata?: Record<string, unknown>;  // platform-specific (e.g., Discord role mentions)
}

interface IncomingMessageHandler {
  (message: Message, context: MessageContext): Promise<void>;
}

interface MessageContext {
  /** Was this agent specifically mentioned/tagged? */
  isMentioned: boolean;
  /** Is this the agent's primary channel? */
  isPrimaryChannel: boolean;
  /** Was another agent mentioned instead? */
  otherAgentMentioned: boolean;
}

interface ReadOptions {
  limit?: number;
  after?: string;   // message ID
  before?: string;  // message ID
}

interface SendOptions {
  replyTo?: string;  // message ID
}

interface SentMessage {
  id: string;
  channel: string;
  timestamp: Date;
}
```

### Why This Works

- `readMessages()` / `sendMessage()` / `sendFile()` cover 95% of what agents need
- `addReaction()` is optional — Telegram/WhatsApp don't have it, Discord/Slack do
- `getExtensions()` handles platform-specific features (Discord voice, Telegram inline keyboards)
- `createTools()` lets each adapter auto-generate its own MCP tools
- `MessageContext` gives the runtime enough info to decide whether to respond without knowing platform specifics

### Adapter Implementations

```
src/core/channels/
├── types.ts              # Interface definitions above
├── discord/
│   ├── adapter.ts        # DiscordChannelAdapter implements ChannelAdapter
│   ├── extensions.ts     # Voice transcription, TTS, role mention conversion
│   └── config.ts         # Discord-specific config schema (guild ID, token, etc.)
├── telegram/
│   ├── adapter.ts        # TelegramChannelAdapter implements ChannelAdapter
│   └── config.ts         # Telegram-specific config (bot token, chat IDs)
├── slack/
│   ├── adapter.ts        # SlackChannelAdapter implements ChannelAdapter
│   └── config.ts         # Slack-specific config (bot token, workspace)
└── whatsapp/
    ├── adapter.ts        # WhatsAppChannelAdapter implements ChannelAdapter
    └── config.ts         # WhatsApp-specific config (API credentials)
```

### Auto-Generated MCP Tools

Each adapter's `createTools()` produces platform-prefixed tools:

```typescript
// Discord adapter generates:
discord_read_channel, discord_post_message, discord_send_file,
discord_add_reaction, discord_transcribe_voice, discord_send_voice

// Telegram adapter generates:
telegram_read_messages, telegram_send_message, telegram_send_file,
telegram_send_photo

// Slack adapter generates:
slack_read_channel, slack_post_message, slack_send_file,
slack_add_reaction, slack_update_message

// WhatsApp adapter generates:
whatsapp_read_messages, whatsapp_send_message, whatsapp_send_file
```

If an agent connects to multiple platforms, all tools are available simultaneously.
The agent's CLAUDE.md instructions guide which to use when.

---

## Layer 2: Event Router (Replaces TriggerManager)

The current `TriggerManager` mixes three concerns: cron scheduling, Discord event handling, and event queuing. Split into:

```typescript
// src/core/runtime/event-router.ts

class EventRouter {
  private queue: QueuedEvent[] = [];
  private isProcessing = false;
  private handler: EventHandler;

  constructor(handler: EventHandler) { ... }

  /** Enqueue an event from any source */
  async enqueue(event: AgentEvent): Promise<void>;

  /** Process events one-at-a-time (same sequential guarantee as today) */
  private async processQueue(): Promise<void>;
}

interface AgentEvent {
  type: 'message' | 'cron' | 'reminder' | 'webhook';
  source: string;                    // adapter type or cron task name
  payload: Record<string, unknown>;
  timestamp: Date;
}
```

**Key change**: The router knows nothing about Discord or any platform. It just queues events and dispatches them sequentially. Each channel adapter pushes events into the router.

---

## Layer 3: Cron as a First-Class Concern

### Config-Driven Cron (Replaces TriggerManager Cron)

Cron schedules move fully into config, each with its own prompt:

```jsonc
// config.json
{
  "cron": [
    {
      "schedule": "*/15 * * * *",
      "task": "check_board",
      "prompt": "Time to check the project board and continue your work..."
    },
    {
      "schedule": "0 9 * * 1-5",
      "task": "morning_standup",
      "prompt": "Good morning. Summarize yesterday's progress and plan today."
    }
  ]
}
```

No more `buildPromptFromTrigger()` with hardcoded if/else chains. The prompt lives next to the schedule.

### Reminder Tools (Stays as MCP Tool)

`schedule_reminder` / `list_reminders` / `cancel_reminder` remain MCP tools — they're runtime-dynamic by nature. No change needed here.

### Cron Scheduler

```typescript
// src/core/runtime/cron-scheduler.ts

class CronScheduler {
  private jobs: cron.ScheduledTask[] = [];

  constructor(
    private config: CronConfig[],
    private router: EventRouter
  ) {}

  start(): void {
    for (const entry of this.config) {
      const job = cron.schedule(entry.schedule, () => {
        this.router.enqueue({
          type: 'cron',
          source: entry.task,
          payload: { schedule: entry.schedule, prompt: entry.prompt },
          timestamp: new Date(),
        });
      });
      this.jobs.push(job);
      // Fire immediately on startup
      this.router.enqueue({ ... });
    }
  }

  stop(): void { ... }
}
```

Small, focused, no Discord knowledge.

---

## Layer 4: Agent Loop (Generic Core)

```typescript
// src/core/runtime/agent-loop.ts

interface AgentLoopConfig {
  systemPrompt: string;
  model: string;
  claudeExecutable?: string;
  allowedTools: string[];           // SDK built-in tools
  mcpServers: McpServerMap;         // auto-generated from adapters + reminders + custom
  costTracker: CostTracker;
  sessionId?: string;
}

async function runAgentLoop(
  config: AgentLoopConfig,
  prompt: string,
  onStatusUpdate?: (status: string) => void,
): Promise<AgentLoopResult> {
  // Same core as today's loop.ts, but:
  // - No createDiscordTools() — tools come from adapters
  // - No createReminderTools() — tools come from tool registry
  // - No Discord-specific status emoji mapping
  // - Just: query() with prompt, system prompt, tools, MCP servers
}
```

The loop shrinks from ~740 lines to ~150 lines — it's just the Claude SDK query orchestration, cost tracking, and session management. All channel-specific tool creation moves to adapters.

---

## Layer 5: Agent Configuration (New Schema)

```jsonc
// agents/dev/config.json
{
  // Identity
  "name": "dev",
  "displayName": "Developer",
  "model": "claude-sonnet-4-20250514",

  // Channel connections (multiple platforms supported)
  "channels": [
    {
      "type": "discord",
      "config": {
        "guildId": "${DISCORD_GUILD_ID}",
        "token": "${DISCORD_TOKEN}",
        "role": "dev",
        "primary": "development",
        "canRead": ["development", "discovery"],
        "canWrite": ["development", "discovery"]
      },
      "triggers": {
        "onMention": true,
        "onMessage": false
      }
    }
    // Could add more:
    // { "type": "telegram", "config": { "botToken": "...", "chatIds": [...] } }
    // { "type": "slack",    "config": { "botToken": "...", "channels": [...] } }
  ],

  // Scheduled tasks with prompts (no hardcoded buildPromptFromTrigger)
  "cron": [
    {
      "schedule": "*/15 * * * *",
      "task": "check_board",
      "prompt": "Time to check the project board and continue your work.\n\n## Steps\n1. **Check for failing PRs first**...\n2. **Check the board**: `gh project item-list`...\n3. Work on ONE ticket at a time."
    }
  ],

  // Guardrails
  "limits": {
    "maxDailyCostUsd": 200,
    "cooldownMinutes": 0
  },

  // Custom MCP tools (optional, for agent-specific tools beyond channels)
  "tools": [],

  // Escalation
  "escalatesTo": "po"
}
```

### What Defines an Agent's Job

| Layer | Where | What It Controls |
|-------|-------|-----------------|
| **Config** | `config.json` | Which channels, what model, cron schedules, cost limits |
| **Instructions** | `CLAUDE.md` | Personality, workflow, rules, coding standards |
| **Skills** | `.claude/skills/` | Discoverable multi-step capabilities (browser testing, image gen) |
| **Tools** | Adapter auto-gen + custom | Runtime API access (messaging, reminders, custom integrations) |

A "developer agent" vs a "personal assistant" is the same runtime with different config + CLAUDE.md + skills. No code changes.

---

## New Directory Structure

```
src/
├── core/                           # Generic runtime (channel-agnostic)
│   ├── runtime/
│   │   ├── agent-loop.ts           # Claude SDK query orchestration
│   │   ├── event-router.ts         # Event queuing and sequential dispatch
│   │   ├── cron-scheduler.ts       # Config-driven cron scheduling
│   │   ├── session-manager.ts      # Session persistence and resumption
│   │   └── prompt-builder.ts       # Generic prompt assembly from events
│   ├── channels/
│   │   ├── types.ts                # ChannelAdapter interface
│   │   ├── registry.ts             # Adapter registration and lifecycle
│   │   ├── discord/
│   │   │   ├── adapter.ts          # DiscordChannelAdapter
│   │   │   ├── extensions.ts       # Voice, TTS, role mentions
│   │   │   └── config.ts           # Discord config schema
│   │   ├── telegram/
│   │   │   ├── adapter.ts
│   │   │   └── config.ts
│   │   ├── slack/
│   │   │   ├── adapter.ts
│   │   │   └── config.ts
│   │   └── whatsapp/
│   │       ├── adapter.ts
│   │       └── config.ts
│   ├── tools/
│   │   ├── reminders.ts            # schedule/list/cancel reminder MCP tools
│   │   └── spend.ts                # get_my_spend MCP tool
│   ├── guardrails/
│   │   ├── cost-tracker.ts         # (unchanged)
│   │   └── cooldown.ts             # (unchanged)
│   └── services/
│       ├── whisper.ts              # (unchanged, used by Discord extension)
│       └── tts.ts                  # (unchanged, used by Discord extension)
│
├── agents/                         # Agent definitions (config only, no code)
│   ├── dev/
│   │   ├── config.json             # Channels, cron, limits
│   │   └── CLAUDE.md               # Developer personality and workflow
│   ├── qa/
│   │   ├── config.json
│   │   └── CLAUDE.md
│   ├── po/
│   │   ├── config.json
│   │   └── CLAUDE.md
│   ├── architect/
│   │   ├── config.json
│   │   └── CLAUDE.md
│   └── personal-assistant/         # New agent type - just config!
│       ├── config.json             # Telegram + WhatsApp channels
│       └── CLAUDE.md               # Personal assistant personality
│
├── config/
│   └── environment.ts              # Generic env loading (no Discord-specific vars)
│
└── index.ts                        # Entry point

# DELETED:
# src/shared/tools/index.ts         (dead createTool/ToolRegistry)
# src/shared/tools/bash.ts          (dead, SDK has Bash built-in)
# src/shared/tools/discord.ts       (split: utilities → discord/adapter.ts,
#                                     tool defs → dead code removed)
# src/agents/*/tools.ts             (dead code, all 4 files)
# src/shared/runner/loop.ts         (replaced by core/runtime/agent-loop.ts)
# src/shared/runner/triggers.ts     (split: cron → cron-scheduler.ts,
#                                     discord → discord/adapter.ts,
#                                     queue → event-router.ts)
# src/shared/runner/index.ts        (replaced by core/runtime/ modules)
```

---

## Startup Flow (New)

```typescript
// src/index.ts

async function main() {
  const env = loadEnvironment();
  const agentName = env.AGENT_NAME;

  // 1. Load agent config and instructions
  const config = await loadConfig(agentName);       // config.json
  const systemPrompt = await loadPrompt(agentName); // CLAUDE.md

  // 2. Create guardrails
  const costTracker = new CostTracker(config.limits);
  const cooldown = new CooldownManager(config.limits.cooldownMinutes);

  // 3. Create channel adapters from config
  const adapters: ChannelAdapter[] = [];
  for (const channelConfig of config.channels) {
    const adapter = createAdapter(channelConfig); // factory: type → adapter
    adapters.push(adapter);
  }

  // 4. Create event router
  const router = new EventRouter(handleEvent);

  // 5. Connect adapters and wire to router
  for (const adapter of adapters) {
    await adapter.connect();
    adapter.onMessage((msg, ctx) => {
      if (ctx.isMentioned || (ctx.isPrimaryChannel && !ctx.otherAgentMentioned)) {
        router.enqueue({
          type: 'message',
          source: adapter.type,
          payload: { message: msg, context: ctx },
          timestamp: msg.timestamp,
        });
      }
    });
  }

  // 6. Collect MCP tools from all adapters + built-in tools
  const mcpServers = buildMcpServers(adapters, reminderManager, costTracker);

  // 7. Start cron scheduler
  const cron = new CronScheduler(config.cron, router);
  cron.start();

  // 8. Start reminder manager
  const reminderManager = new ReminderManager(agentName);
  reminderManager.setHandler((event) => router.enqueue(event));
  await reminderManager.start();

  // 9. Event handler (same core logic as today, but generic)
  async function handleEvent(event: AgentEvent) {
    const prompt = buildPrompt(event, config);  // reads prompt from event/config
    const result = await runAgentLoop({
      systemPrompt,
      model: config.model,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
      mcpServers,
      costTracker,
      sessionId: sessionManager.getSessionId(),
    }, prompt);
    sessionManager.saveSession(result.sessionId);
  }
}
```

---

## Migration Path

### Phase 1: Clean Up Dead Code (No Behavior Change)

Remove the dead tool system identified in the previous analysis:
- Delete `src/agents/*/tools.ts` (4 files)
- Delete `src/shared/tools/bash.ts`
- Clean up `src/shared/tools/index.ts` and `discord.ts`
- Remove dead types from `src/shared/types.ts`
- Remove dead fields from `LoadedAgent` and `AgentContext`

### Phase 2: Extract Channel Adapter Interface

1. Create `src/core/channels/types.ts` with the `ChannelAdapter` interface
2. Create `src/core/channels/discord/adapter.ts` by extracting:
   - Discord connection logic from `src/shared/tools/discord.ts` (`getDiscordClient`)
   - Discord event handling from `src/shared/runner/triggers.ts` (`setupDiscordEvents`, `catchUpMissedMessages`)
   - Discord MCP tool creation from `src/shared/runner/loop.ts` (`createDiscordTools`)
   - Discord-specific extensions (voice/TTS) from `loop.ts`
3. Verify: everything still works with only Discord adapter

### Phase 3: Extract Generic Runtime

1. Create `src/core/runtime/event-router.ts` from `TriggerManager`'s queue logic
2. Create `src/core/runtime/cron-scheduler.ts` from `TriggerManager`'s cron logic
3. Create `src/core/runtime/agent-loop.ts` from `loop.ts` (remove Discord-specific code)
4. Create `src/core/runtime/prompt-builder.ts` from `buildPromptFromTrigger()` (config-driven)
5. Move cron prompts into each agent's `config.json`

### Phase 4: New Config Schema

1. Update `AgentConfig` type to new schema (channels array, cron with prompts)
2. Migrate existing agent configs
3. Update environment.ts to remove Discord-specific env vars (move to adapter config)

### Phase 5: Add New Adapters (Incremental)

Each new adapter is isolated work:
1. `src/core/channels/telegram/adapter.ts` — uses `telegraf` or `node-telegram-bot-api`
2. `src/core/channels/slack/adapter.ts` — uses `@slack/bolt`
3. `src/core/channels/whatsapp/adapter.ts` — uses WhatsApp Business API

### Phase 6: New Agent Types

With the generic runtime, creating a personal assistant is just config:
```
agents/personal-assistant/
├── config.json    # telegram + whatsapp channels, daily cron
└── CLAUDE.md      # "You are a personal assistant..."
```

No code changes needed.

---

## Key Design Decisions

### 1. Platform-Prefixed Tool Names (Not Generic)

Tools are `discord_read_channel`, `telegram_send_message`, not generic `read_channel`. Reason: an agent connected to both Discord and Telegram needs to specify *where* to send a message. The CLAUDE.md instructions tell the agent which tools to use for which purpose.

### 2. Adapters Own Their Tools

Each adapter's `createTools()` generates its own MCP tools. The runtime collects them. This means adding a new platform automatically gives agents the right tools — no loop.ts changes.

### 3. Config Over Code for Agent Behavior

The current `buildPromptFromTrigger()` function hardcodes dev/qa/po-specific knowledge in the shared runner. In the new architecture, cron prompts live in config.json. The runtime just reads `event.payload.prompt` and passes it through.

### 4. Sequential Event Processing Preserved

The queue-based one-at-a-time processing model stays. It's simple and correct for agents that share state (session, cost tracker). No need for concurrency here.

### 5. Session Continuity Preserved

Session resumption across triggers stays exactly as-is. The `sessionId` is saved/loaded by `SessionManager` and passed to `runAgentLoop()`.

---

## What Changes vs What Stays

| Component | Current | New | Change Type |
|-----------|---------|-----|-------------|
| Agent loop core | `loop.ts` (740 lines, Discord-coupled) | `agent-loop.ts` (~150 lines, generic) | **Rewrite** |
| Discord integration | Spread across 3 files | `discord/adapter.ts` (single file) | **Consolidate** |
| Trigger system | `TriggerManager` (430 lines, Discord+cron mixed) | `EventRouter` + `CronScheduler` + adapters | **Split** |
| Tool system | Two parallel systems (dead + MCP) | Adapter-generated MCP only | **Simplify** |
| Prompt building | `buildPromptFromTrigger()` with hardcoded if/else | Config-driven prompts | **Move to config** |
| Reminder system | `ReminderManager` + MCP tools | Unchanged | **Keep** |
| Guardrails | `CostTracker` + `CooldownManager` | Unchanged | **Keep** |
| Services | `whisper.ts`, `tts.ts` | Move under `discord/extensions.ts` | **Relocate** |
| Agent configs | Discord-specific fields at top level | `channels[]` array with typed configs | **Restructure** |
| Agent CLAUDE.md | Unchanged | Unchanged | **Keep** |
| Agent skills | `.claude/skills/` | Unchanged | **Keep** |
| Dead tool system | `tools/`, agent `tools.ts` | Deleted | **Remove** |

---

## Example: Personal Assistant Agent

To show the power of the generic runtime — creating a totally different agent type with zero code:

```jsonc
// agents/personal-assistant/config.json
{
  "name": "assistant",
  "displayName": "Personal Assistant",
  "model": "claude-sonnet-4-20250514",
  "channels": [
    {
      "type": "telegram",
      "config": {
        "botToken": "${TELEGRAM_BOT_TOKEN}",
        "allowedChatIds": ["${MY_TELEGRAM_CHAT_ID}"]
      },
      "triggers": {
        "onMention": true,
        "onMessage": true
      }
    }
  ],
  "cron": [
    {
      "schedule": "0 8 * * 1-5",
      "task": "morning_briefing",
      "prompt": "Good morning. Check my calendar, summarize any important emails, and remind me of today's priorities."
    },
    {
      "schedule": "0 18 * * 1-5",
      "task": "daily_summary",
      "prompt": "End of day. Summarize what was accomplished today and flag anything that needs follow-up tomorrow."
    }
  ],
  "limits": {
    "maxDailyCostUsd": 20,
    "cooldownMinutes": 0
  },
  "tools": [],
  "escalatesTo": null
}
```

```markdown
<!-- agents/personal-assistant/CLAUDE.md -->
# Personal Assistant

You are a personal assistant helping manage daily tasks, communications, and schedule.

## Your Responsibilities
1. Respond to messages promptly and helpfully
2. Manage reminders and follow-ups
3. Summarize information when asked
4. Help draft messages and documents

## Communication Style
- Be concise and friendly
- Proactively suggest follow-ups
- Use reminders for time-sensitive items
```

Same runtime, completely different agent. Just config + instructions.
