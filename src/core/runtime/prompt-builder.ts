/**
 * Prompt Builder
 *
 * Builds prompts from trigger events using config-driven cron prompts.
 * Supports variable substitution for dynamic content.
 */

import type { TriggerEvent, AgentConfig } from '../../shared/types.js';

/**
 * Cron prompt configuration
 */
export interface CronPromptConfig {
  schedule: string;
  task: string;
  prompt?: string;
}

/**
 * Variables available for prompt templating
 */
export interface PromptVariables {
  date: string;
  time: string;
  agentName: string;
  journalPath: string;
  [key: string]: string;
}

/**
 * Build context header with journal and date information
 */
export function buildJournalContext(agentName: string): string {
  const today = new Date().toISOString().split('T')[0];
  const time = new Date().toTimeString().split(' ')[0].slice(0, 5);

  return `
---
**Context:**
- Date: ${today}
- Time: ${time}
- Your journal: data/journals/${agentName}/${today}.md
- Shared docs: data/shared/

Remember to read your recent journal entries for context and update today's journal with important learnings when done.
---

`;
}

/**
 * Get default variables for prompt templating
 */
export function getPromptVariables(agentName: string): PromptVariables {
  const today = new Date().toISOString().split('T')[0];
  const time = new Date().toTimeString().split(' ')[0].slice(0, 5);

  return {
    date: today,
    time,
    agentName,
    journalPath: `data/journals/${agentName}/${today}.md`,
  };
}

/**
 * Substitute variables in a prompt template
 *
 * @param template - Prompt template with {variable} placeholders
 * @param variables - Variables to substitute
 * @returns Prompt with variables replaced
 */
export function substituteVariables(template: string, variables: PromptVariables): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return variables[key] ?? match;
  });
}

/**
 * Find cron prompt config by task name
 */
export function findCronPrompt(config: AgentConfig, taskName: string): string | undefined {
  const cronEntry = config.cron.find((c) => c.task === taskName) as CronPromptConfig | undefined;
  return cronEntry?.prompt;
}

/**
 * Default prompts for known cron tasks (fallback when not in config)
 */
const DEFAULT_CRON_PROMPTS: Record<string, string> = {
  check_mentions: `Time to check Discord channels for anything needing your attention.

## Steps:
1. **Read #development** for any new requests, questions, or blockers from the team
2. **Check the board** for tickets needing attention (stuck, unclear requirements)
3. **Respond** to anything that needs your input

If nothing needs attention, just wait silently - do NOT post saying you have nothing to do.`,

  check_board: `Time to check the project board and continue your work.

## Steps:
1. **Check for failing PRs first**:
   \`gh pr list --json number,title,statusCheckRollup --jq '.[] | select(.statusCheckRollup[]?.conclusion == "FAILURE")'\`
   Fix any failing builds before starting new work.

2. **Check the board**: \`gh project item-list\` to see tickets
3. **Priority**: "In Progress" tickets first, then "Ready for Dev"
4. **Read the issue**: \`gh issue view {number} --json body,comments\`
   - Look for "Implementation Plan" - your roadmap
   - Look for "Progress Update" - where you left off
5. **Continue or start**: Pick up where the last progress update ended
6. **Save progress**: After each major step, comment on the issue with your progress

Work on ONE ticket at a time. Fix failing PRs first, then continue board work.`,

  check_reviews: `Time to check for PRs needing code review.

## Steps:
1. **List items in "In Review" column** on the project board
2. **For each item with an open PR**, check if it needs review
3. **Review the PR**:
   - Read the ticket for acceptance criteria
   - Get the PR diff: \`gh pr diff {number}\`
   - Check CI status: \`gh pr checks {number}\`
4. **Submit review**: Approve or request changes via \`gh pr review\`
5. **Update the board**: Move to Done (approved) or In Progress (changes needed)
6. **Notify in Discord**: Post the outcome to #development`,

  check_prs: `Time to check for PRs needing QA testing.

## Steps:
1. **List items in "In Review" column** on the project board
2. **For each item with an open PR**, check if it needs QA testing
3. **Check CI status first**: \`gh pr checks {number}\` - skip if failing
4. **Read the linked issue** for acceptance criteria
5. **Test the PR**:
   - Checkout the PR: \`gh pr checkout {number}\`
   - Run the app locally
   - Use \`agent-browser\` to verify functionality works
   - Test scroll behavior on mobile for layout changes
   - Check tests exist and pass
6. **Post QA results**: Comment on PR with verdict (pass/fail with evidence)
7. **Notify in Discord**: Post outcome to #development

If nothing needs QA testing, wait silently - do NOT post saying you have nothing to do.`,
};

/**
 * Build a prompt for a cron trigger event
 */
export function buildCronPrompt(
  config: AgentConfig,
  taskName: string,
  variables: PromptVariables
): string {
  // Try to get prompt from config first
  let promptTemplate = findCronPrompt(config, taskName);

  // Fall back to default prompts
  if (!promptTemplate) {
    promptTemplate = DEFAULT_CRON_PROMPTS[taskName];
  }

  // Final fallback for unknown tasks
  if (!promptTemplate) {
    promptTemplate = `Scheduled task triggered: ${taskName}

Please perform your scheduled duties.`;
  }

  // Substitute variables
  return substituteVariables(promptTemplate, variables);
}

/**
 * Build a prompt for a Discord trigger event
 */
export function buildDiscordPrompt(event: TriggerEvent, _variables: PromptVariables): string {
  const channel = event.source;
  const author = event.payload.author as string;
  const content = event.payload.content as string;

  return `You received a message in Discord channel #${channel}.

Message from ${author}:
"${content}"

Please read the channel for context and respond appropriately.`;
}

/**
 * Build a prompt for a reminder trigger event
 */
export function buildReminderPrompt(event: TriggerEvent, _variables: PromptVariables): string {
  const message = event.payload.message as string;
  const recurring = event.payload.recurring as boolean;

  return `⏰ **Reminder:** ${message}

This is ${recurring ? 'a recurring' : 'a one-time'} reminder you set for yourself.
Please take the appropriate action.`;
}

/**
 * Build a prompt from a trigger event
 *
 * This is the main entry point that replaces the hardcoded buildPromptFromTrigger.
 * It reads prompts from agent config when available, falling back to defaults.
 *
 * @param event - The trigger event
 * @param config - Agent configuration (contains cron prompts)
 * @returns Complete prompt with journal context
 */
export function buildPromptFromTrigger(event: TriggerEvent, config: AgentConfig): string {
  const journalContext = buildJournalContext(config.name);
  const variables = getPromptVariables(config.name);

  let promptBody: string;

  switch (event.type) {
    case 'discord_mention':
    case 'discord_message':
      promptBody = buildDiscordPrompt(event, variables);
      break;

    case 'cron':
      promptBody = buildCronPrompt(config, event.source, variables);
      break;

    case 'reminder':
      promptBody = buildReminderPrompt(event, variables);
      break;

    default:
      promptBody = `Trigger event received: ${event.type} from ${event.source}`;
  }

  return journalContext + promptBody;
}
