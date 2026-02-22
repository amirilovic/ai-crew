# Testing Strategy

**Last Updated:** 2026-02-13
**Owner:** Product Team
**Status:** Draft for Review

## Philosophy

**Goal:** Build confidence that user experience works correctly, not to achieve 100% code coverage.

**Key Principle:** Quality over quantity. Write tests that matter, not tests for the sake of testing.

---

## Test Pyramid (Inverted for This Team)

```
        E2E (Few)
    Integration (Many)
  Unit (Selective)
```

Unlike traditional test pyramids, we prioritize **integration tests** because they:
- Verify actual user workflows
- Catch real-world issues
- Test components working together
- Give confidence in user experience

---

## Testing Guidelines by Type

### 1. Integration Tests (Preferred)

**What:** Test multiple components/features working together

**When to write:**
- User workflows (login → dashboard → action)
- Feature interactions (form submission → validation → success state)
- Component integration (parent → child communication)
- Data flow (API → state → UI)

**Examples:**
- ✅ "User can create, edit, and delete a todo item"
- ✅ "Dark theme persists across page navigation"
- ✅ "Form validation shows errors and submits successfully"
- ✅ "Property editor layout changes persist when switching editors"

**Why preferred:**
- Catches regression in user experience
- Tests realistic scenarios
- Higher value per test written

---

### 2. E2E Tests (Selective)

**What:** Full user journey from start to finish

**When to write:**
- Critical user paths (signup, checkout, data export)
- Cross-page workflows
- High-risk areas (authentication, payments, data loss)

**When NOT to write:**
- Edge cases (better handled by integration tests)
- Every possible path (too slow, too brittle)
- UI variations (prefer visual regression tests)

**Examples:**
- ✅ "User can sign up, verify email, and access dashboard"
- ✅ "Builder: Create project → add components → preview → export"
- ❌ "Test every button color variant" (overkill)

**Guidelines:**
- Keep E2E tests **focused and fast**
- Limit to **critical happy paths**
- Run less frequently (pre-merge, not on every commit)

---

### 3. Unit Tests (Selective)

**What:** Test individual functions/components in isolation

**When to write:**
- Complex business logic (calculations, algorithms)
- Utility functions (date formatting, validation)
- Edge cases that are hard to trigger via integration tests
- Pure functions with clear inputs/outputs

**When NOT to write:**
- Simple getters/setters
- Trivial components (wrappers, containers)
- Code that's better tested through integration
- Implementation details (internal state, private methods)

**Examples:**
- ✅ "calculateTotalPrice handles discounts correctly"
- ✅ "validateEmail rejects invalid formats"
- ✅ "formatDate handles edge cases (leap years, timezones)"
- ❌ "Button renders with correct className" (integration test is better)

---

## Acceptance Criteria Requirements

**Every ticket MUST include a "Testing" section in acceptance criteria:**

### Template:

```markdown
## Acceptance Criteria
- [ ] Feature works as described
- [ ] Code follows team conventions
- [ ] **Tests written and passing:**
  - [ ] Integration test: [describe user workflow to test]
  - [ ] E2E test (if applicable): [describe critical path]
  - [ ] Unit tests (if applicable): [describe complex logic]
```

### Example (Dark Theme Feature):

```markdown
## Acceptance Criteria
- [ ] Dark theme applied to all components
- [ ] Theme persists across page reloads
- [ ] **Tests written and passing:**
  - [ ] Integration test: User toggles dark theme, navigates pages, theme persists
  - [ ] Integration test: Theme preference stored in localStorage
  - [ ] Unit test: Color utility functions handle all theme variations
```

---

## Reviewer Responsibilities

### Code Reviewer Must Verify:

1. **Tests exist** for the feature (block PR if missing, unless docs/config)
2. **Tests make sense** - they verify user experience, not implementation
3. **Test quality** - clear, maintainable, not brittle
4. **Test coverage** - critical paths covered, edge cases considered

### Questions Reviewer Should Ask:

- "Does this test verify what users care about?"
- "Will this test catch regressions?"
- "Is this test too coupled to implementation details?"
- "Are there obvious edge cases missing?"

### When to Request Changes:

- ❌ No tests for feature changes
- ❌ Tests only check implementation (internal state, private methods)
- ❌ Tests are brittle (will break on refactor)
- ❌ Critical user paths not covered
- ✅ Tests verify user experience
- ✅ Tests are clear and maintainable

---

## When Tests Are Optional

**Skip tests for:**
- Documentation-only changes
- Configuration files (package.json, tsconfig.json)
- Pure renames/moves with no logic changes
- Minor copy/text updates

**Always write tests for:**
- New features
- Bug fixes
- Behavior changes
- Data handling
- User interactions

---

## Test Maintenance

### Keep Tests Valuable:

1. **Delete tests that don't add value** - if a test never fails or tests trivial code, remove it
2. **Update tests with features** - don't let test suite become stale
3. **Refactor brittle tests** - if tests break on every refactor, they're testing the wrong thing
4. **Monitor test run time** - slow tests should be optimized or moved to nightly runs

### Red Flags:

- 🚩 Test suite takes > 5 minutes to run
- 🚩 Tests frequently fail for unrelated changes (brittle)
- 🚩 Tests check internal implementation details
- 🚩 Mocking everything (not testing realistic scenarios)

---

## Tools & Framework

**To be decided by team based on project:**
- **Integration tests:** Testing Library, Vitest, Jest
- **E2E tests:** Playwright, Cypress
- **Visual regression:** Chromatic, Percy (optional)

---

## Success Metrics

**We're doing testing right when:**
- ✅ Tests catch bugs before users do
- ✅ Refactoring doesn't break the test suite
- ✅ New developers understand expected behavior from tests
- ✅ PRs include tests by default (cultural norm)
- ✅ Team is confident deploying after tests pass

**We're doing testing wrong when:**
- ❌ Tests take forever to run
- ❌ Tests fail randomly (flaky)
- ❌ Bugs still reach production despite passing tests
- ❌ Writing tests feels like busywork
- ❌ Tests are always out of date

---

## Team Review & Adoption

**This document is a draft.** All team members (@dev, @qa, @po) should:

1. **Review this strategy** - does it match our needs?
2. **Propose changes** - what's missing? What's wrong?
3. **Agree on adoption** - are we committed to this approach?

**Once approved, this becomes our testing standard for all future work.**

---

## Questions for Team Discussion

1. Do we agree integration tests should be our primary focus?
2. What E2E tests are critical for our projects (jrd, ccpa-telegram)?
3. What testing frameworks should we use?
4. Should we retroactively add tests to existing code, or just new work?
5. How do we handle testing for refactors (existing code has no tests)?

---

## Action Items After Approval

- [ ] Update issue templates to include testing acceptance criteria
- [ ] Update qa CLAUDE.md with testing verification checklist
- [ ] Add testing examples to shared docs
- [ ] (Optional) Add testing workshop/training for team
- [ ] Decide on testing frameworks and set up in both repos
