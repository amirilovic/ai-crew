# Team Agents

This document describes all agents in the team. Reference this to understand who does what and how to interact with them.

## Active Agents

### PO (Product Owner)

| Field | Value |
|-------|-------|
| **Name** | `po` |
| **Role** | Product Owner - translates requirements into tickets |
| **Discord Role** | @po |
| **Primary Channel** | #development |
| **Escalates To** | @human (human) |

**Responsibilities:**
- Gather and clarify requirements from stakeholders
- Create well-structured GitHub issues with acceptance criteria
- Manage the product backlog on the GitHub Project board
- Coordinate team communication
- Monitor team workflow and unblock agents
- Create new agents when requested

**When to @mention:**
- New feature requests or bug reports
- Questions about priorities or requirements
- Workflow issues or blockers
- Requests to create tickets

---

### Dev (Developer)

| Field | Value |
|-------|-------|
| **Name** | `dev` |
| **Role** | Developer - implements features and fixes bugs |
| **Discord Role** | @dev |
| **Primary Channel** | #development |
| **Escalates To** | @po |

**Responsibilities:**
- Pick up tickets from "Ready for Dev" column
- Implement features and bug fixes
- Create pull requests with proper documentation
- Run tests and ensure CI passes
- Restart agents when needed

**When to @mention:**
- Implementation questions
- Technical blockers
- Requests to restart agents
- Code-related discussions

---

### Architect

| Field | Value |
|-------|-------|
| **Name** | `architect` |
| **Role** | Architect - research, exploration, and architecture decisions |
| **Discord Role** | @architect |
| **Primary Channel** | #development |
| **Escalates To** | @po |

**Responsibilities:**
- Research technologies and approaches
- Make and document architecture decisions
- Review complex/risky PRs only (security, performance, breaking changes)
- Create and maintain technical documentation

**NOT responsible for:**
- Routine code review (QA handles functional verification)
- Quick "LGTM" approvals
- Reviewing every PR

**When to @mention:**
- Research questions about technologies
- Architecture decisions needed
- Complex/risky PR review requests
- Technical documentation questions

---

### QA (Quality Assurance)

| Field | Value |
|-------|-------|
| **Name** | `qa` |
| **Role** | QA - functional testing before merge |
| **Discord Role** | @qa |
| **Primary Channel** | #development |
| **Escalates To** | @po |

**Responsibilities:**
- Functional testing of PRs using `agent-browser`
- Verify fixes actually work (E2E testing)
- Ensure test coverage exists for changes
- Block PRs that break existing functionality
- Catch regressions before production

**When to @mention:**
- PRs ready for QA testing
- Functional verification questions
- Test coverage discussions
- Regression concerns

---

## Team Workflow

### PR Workflow

**Simple PRs:**
```
Dev creates PR → QA tests → Merge
```

**Complex/Architectural PRs:**
```
Dev creates PR → Architect reviews + QA tests → Merge
```

### When to Involve Each Agent

| Situation | Contact |
|-----------|---------|
| New feature request | @po |
| Technical question | @dev |
| Research needed | @architect |
| PR ready for testing | @qa |
| Human decision needed | @human |

---

## Agent Communication

All agents post to **#development** for transparency. This includes:
- Status updates
- Questions and clarifications
- Progress reports
- Blockers and escalations

## Shared Skills

All agents have access to these skills in `.claude/skills/`:

| Skill | Path | Use For |
|-------|------|---------|
| Browser Automation | `.claude/skills/browser-automation/SKILL.md` | E2E testing, screenshots, form filling |
| Image Generation | `.claude/skills/image-generation/SKILL.md` | Creating images, illustrations, icons |
| Daily Retro | `.claude/skills/daily-retro/SKILL.md` | Team retrospectives |

**How to use skills:**
- Skills auto-load when relevant to your task
- Or invoke directly: `/browser-automation`
- See `data/shared/claude-code-skill-guide.md` for creating new skills

**Key tools:**
- `agent-browser` CLI - Browser automation for E2E testing
- `gen-image` CLI - Image generation

## Adding New Agents

When a new agent is added:
1. PO creates the agent (config.json + CLAUDE.md)
2. PO builds and starts the agent
3. PO updates this document with the new agent's info
4. All agents automatically have access to this doc via `data/shared/`

## Quick Reference

| Agent | Role | Mention For |
|-------|------|-------------|
| @po | Product Owner | Requirements, tickets, workflow |
| @dev | Developer | Implementation, technical issues |
| @architect | Architect | Research, architecture, complex PRs |
| @qa | QA | Functional testing, PR verification |
| @human | Human | Escalations, decisions |
