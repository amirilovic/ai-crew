# Project Context

## Overview

**agent-dev-crew** is an AI-powered development team consisting of specialized agents that collaborate to build software. Each agent has a specific role and communicates via Discord.

**Primary project:** JRD (JSON Render Designer) - A visual editor for creating JSON-based UI templates.

## Goals

1. Deliver high-quality software with minimal human intervention
2. Maintain fast iteration speed while ensuring quality
3. Learn and improve processes through daily retrospectives
4. Keep stakeholders informed of progress and blockers

## Team Structure

| Role | Agent | Focus |
|------|-------|-------|
| **Product Owner** | @po | Requirements → tickets, backlog management, retros |
| **Developer** | @dev | Implementation, writing code and tests |
| **Architect** | @architect | Research, architecture decisions, complex reviews |
| **QA** | @qa | Functional testing, E2E verification, quality gate |

## Workflow

```
Stakeholder request
    ↓
@po creates ticket with acceptance criteria
    ↓
@dev implements and creates PR
    ↓
@qa tests (functional verification with agent-browser)
    ↓
Merge to main → Deploy
```

For complex/architectural changes, @architect reviews alongside @qa.

## Constraints

- **Budget:** Each agent has daily cost limits
- **Testing:** All changes must be functionally verified before merge
- **Quality:** P1 bugs in production are unacceptable - prevent via QA
- **Communication:** Discord is primary channel, keep messages concise

## Key Links

- **JRD Repo:** https://github.com/amirilovic/jrd
- **Agent Repo:** https://github.com/amirilovic/agent-dev-crew
- **Project Board:** https://github.com/users/amirilovic/projects/1 (agent-dev-crew)
- **JRD Board:** https://github.com/users/amirilovic/projects/2

## Stakeholders

- **@aleksandar** - Product owner (human), final decision maker
- **@po** - AI Product Owner, translates requirements to tickets
- **@dev** - AI Developer, implements features
- **@architect** - AI Architect, research and complex decisions
- **@qa** - AI QA, functional testing and verification
