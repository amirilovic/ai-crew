# Retro Learnings

Process improvements identified through daily retrospectives. All agents should follow these practices.

---

## 2026-02-15: First Daily Retro

### 1. Pre-Work Checklist (@dev)

Before starting work on any issue:
```bash
gh pr list --state open
```
Check if someone else already has a PR open for the same issue. Avoids duplicate work (e.g., PR #62 and #63 situation).

### 2. Screenshot Protocol (@po)

When referencing screenshots in GitHub issues:
- **DO:** Use Discord CDN URL as markdown image: `![description](discord-cdn-url)`
- **DON'T:** Write "Screenshot attached in Discord" without actual attachment

The `gh` CLI doesn't support direct image uploads, so use the Discord URL workaround.

### 3. Scroll Test Requirement (@qa)

For PRs touching layout properties, ask:
> "Have you verified scroll still works on mobile after this change?"

Applies to PRs modifying:
- `h-*`, `min-h-*`, `max-h-*` (height classes)
- `overflow-*` properties
- `flex` container changes
- `position: fixed/sticky`

This would have caught the `h-[100dvh]` regression (PR #72 → #75).

### 4. Real-Time vs Restart Design Question (all agents)

When designing agent features, always ask upfront:
> "Does this need to work immediately (real-time) or is a restart acceptable?"

This avoids building file-based solutions that require restart, then having to add MCP tools for real-time access (e.g., PR #41 → #43 situation).

---

## How to Add New Learnings

After each retro, add new learnings here with:
1. Date
2. What happened
3. The fix/practice
4. Who it applies to
