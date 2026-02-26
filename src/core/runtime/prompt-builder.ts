/**
 * Prompt Builder
 *
 * Builds prompts from trigger events.
 * Prompts are now stored directly in task configs - no more hard-coded lookups!
 * Supports variable substitution for dynamic content.
 */

import type { TriggerEvent, AgentConfig } from '../../shared/types.js';

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
 * Build a prompt for a scheduled task event
 * The prompt is now stored directly in the task config - no more hard-coded prompts!
 */
export function buildScheduledTaskPrompt(event: TriggerEvent, variables: PromptVariables): string {
  // The prompt is now directly in the event payload
  const prompt = event.payload.prompt as string | undefined;
  const taskName = (event.payload.taskName as string) || event.source;

  if (!prompt) {
    // Fallback for tasks without a prompt (shouldn't happen with new format)
    return `Scheduled task triggered: ${taskName}

Please perform your scheduled duties.`;
  }

  // Substitute variables in the prompt
  return substituteVariables(prompt, variables);
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
 * Build a prompt from a trigger event
 *
 * This is the main entry point for converting trigger events to prompts.
 * Prompts are now stored directly in task configs - no more hard-coded lookups!
 *
 * @param event - The trigger event
 * @param config - Agent configuration
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

    case 'scheduled_task':
      promptBody = buildScheduledTaskPrompt(event, variables);
      break;

    default:
      promptBody = `Trigger event received: ${event.type} from ${event.source}`;
  }

  return journalContext + promptBody;
}
