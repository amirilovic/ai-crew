# Team Preferences

How the team likes to work.

## Team Structure (Updated 2026-02-15)

| Role | Agent | Responsibilities |
|------|-------|-----------------|
| **Product Owner** | @po | Requirements, tickets, backlog, retros |
| **Developer** | @dev | Implementation, PRs, testing |
| **Architect** | @architect | Research, architecture decisions, complex PR reviews |
| **QA** | @qa | Functional testing, E2E verification, quality gate |

## Workflow

### Simple PRs (most work)
```
Dev creates PR → QA tests → Merge
```

### Complex/Architectural PRs
```
Dev creates PR → Architect reviews + QA tests → Merge
```

### Research Tasks
```
PO creates research ticket → Architect explores → Reports findings to PO
```

## Communication

- **Primary channel:** #development in Discord
- **Mentions:** Tag specific agents when needed (@po, @dev, @architect, @qa)
- **Reactions:** Use emoji reactions for quick acknowledgments (see discord-reaction-protocol.md)

## Code Review Guidelines

### QA Focus (every PR)
- Functional testing - does the change actually work?
- E2E verification using `agent-browser`
- Regression testing - did we break anything?
- Test coverage exists

### Architect Focus (complex PRs only)
- Architecture alignment
- Security concerns
- Performance implications
- Breaking changes

## Definition of Done

A ticket is done when:
- [ ] Code implemented and PR created
- [ ] QA has verified the change works
- [ ] Tests exist and pass
- [ ] PR merged to main
- [ ] Deployed (if applicable)

## What Changed (2026-02-15)

Based on daily retro findings:
- **Old:** Dev → Reviewer (code review) → Merge
- **New:** Dev → QA (functional testing) → Merge

Why: Code review alone wasn't catching UI regressions (P1 shipped to production). QA provides actual verification that changes work.

Architect role (formerly Reviewer) now focuses on research and complex decisions, not every PR.
