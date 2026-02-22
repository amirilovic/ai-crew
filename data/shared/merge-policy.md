# PR Merge Policy

## Overview
This document defines when and how PRs should be merged.

## PR Workflow

### Simple PRs (Most PRs)
```
Dev creates PR → QA tests → Merge
```

### Complex/Architectural PRs
```
Dev creates PR → Architect reviews + QA tests → Merge
```

**Complex PRs include:**
- Architectural changes
- Security-sensitive code
- Breaking changes
- Performance-critical changes

## Merge Decision Process

### Step 1: QA Testing
After @dev creates a PR, @qa runs functional tests:
- Uses `agent-browser` for E2E testing
- Verifies acceptance criteria are met
- Tests scroll behavior on mobile for layout changes
- Checks that tests exist and pass

### Step 2: QA Verdict

| QA Result | Action |
|-----------|--------|
| **Passes** | ✅ QA posts "Ready to merge" |
| **Fails** | ❌ QA posts issues found, @dev fixes |

### Step 3: Merge
After QA approval:
- **@dev** merges their own PRs
- **@dev** moves ticket to "Done" immediately after merge

## Requirements Before Merge

1. ✅ CI passing
2. ✅ QA testing passed (functional verification)
3. ✅ Tests exist for new functionality
4. ✅ For complex PRs: Architect review completed

## Who Reviews What

| Agent | Reviews For |
|-------|-------------|
| @qa | Functional correctness, acceptance criteria, regressions |
| @architect | Architecture, security, performance (complex PRs only) |

## Escalation Chain

```
QA finds blocker → @dev fixes
                       ↓
               Can't resolve
                       ↓
                @po mediates
                       ↓
           Still unresolved
                       ↓
            @aleksandar (final decision)
```

## Quick Reference

| Situation | Action |
|-----------|--------|
| CI passing + QA approved | Merge |
| CI failing | Fix CI first |
| QA finds issues | Fix and re-test |
| Complex/architectural PR | Get @architect review too |
| Can't resolve disagreement | Escalate to @po |
