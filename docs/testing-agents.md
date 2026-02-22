# Testing Agents: Approach & Guidelines

This document describes the testing approach for the agent-dev-crew project.

## Overview

Testing AI agents presents unique challenges:
- **Non-deterministic behavior**: Agents may make different decisions based on context
- **External dependencies**: Discord, GitHub, file system, Claude API
- **Async workflows**: Agents run on schedules and triggers
- **State persistence**: Agent memory and context across sessions

Our testing strategy addresses these challenges with a layered approach.

## Testing Strategy

### Test Pyramid (Adapted for Agents)

```
         /\
        /  \
       / E2E \     <- Minimal (expensive, flaky)
      /------\
     /        \
    /Integration\   <- Most valuable (mocked externals)
   /--------------\
  /                \
 /    Unit Tests    \  <- Foundation (pure functions)
/--------------------\
```

### 1. Unit Tests

Test pure functions and utilities in isolation.

**What to test:**
- Logger configuration
- Tool input validation (Zod schemas)
- Data transformation functions
- Configuration parsing

**Example:**
```typescript
// src/__tests__/logger.test.ts
describe('createLogger', () => {
  it('creates a logger with the specified agent name', () => {
    const logger = createLogger('my-agent');
    expect(logger.defaultMeta).toEqual({ agent: 'my-agent' });
  });
});
```

### 2. Integration Tests

Test tool execution with mocked external services.

**What to test:**
- Tool registry operations
- Tool execution with mocked APIs
- Agent workflow steps (with mocked Discord/GitHub)

**Mocking approach:**
- Use `vi.mock()` to mock Discord.js and Octokit
- Create mock helpers in `src/__tests__/helpers/`
- Test tool behavior without network calls

**Example:**
```typescript
// src/__tests__/tools/registry.test.ts
describe('ToolRegistry', () => {
  it('executes tools by name', async () => {
    const registry = new ToolRegistry();
    registry.register(myTool);

    const result = await registry.execute('my_tool', { value: 42 });
    expect(result).toEqual({ success: true });
  });
});
```

### 3. E2E Tests (Future)

Full agent workflows with real services (test environment).

**Not implemented yet.** Would require:
- Test Discord server with test channels
- Test GitHub repository
- Test API keys
- Careful isolation from production

## Test File Organization

```
src/
├── __tests__/
│   ├── helpers/
│   │   ├── discord-mock.ts    # Discord.js mock utilities
│   │   └── github-mock.ts     # GitHub API mock utilities
│   ├── tools/
│   │   └── registry.test.ts   # Tool registry tests
│   └── logger.test.ts         # Logger tests
├── shared/
│   ├── tools/
│   │   └── index.ts
│   └── logger.ts
└── ...
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run in watch mode (development)
pnpm test:watch

# Run with coverage report
pnpm test:coverage
```

## Writing New Tests

### Guidelines

1. **Test behavior, not implementation**
   - Focus on what the function does, not how it does it
   - Makes tests more resilient to refactoring

2. **Use descriptive test names**
   - `it('returns error when channel not found')` ✓
   - `it('test1')` ✗

3. **Isolate tests**
   - Each test should be independent
   - Use `beforeEach` for setup, clean up after

4. **Mock external dependencies**
   - Never make real API calls in tests
   - Use mock helpers from `__tests__/helpers/`

### Template for Tool Tests

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDiscordClient } from '../helpers/discord-mock.js';

// Mock the Discord client module
vi.mock('../../shared/tools/discord.js', () => ({
  getDiscordClient: vi.fn(),
}));

describe('myTool', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('handles the happy path', async () => {
    // Arrange
    const mockClient = createMockDiscordClient();
    vi.mocked(getDiscordClient).mockResolvedValue(mockClient);

    // Act
    const result = await myTool.execute({ input: 'test' });

    // Assert
    expect(result).toEqual({ success: true });
  });

  it('handles errors gracefully', async () => {
    // Arrange
    vi.mocked(getDiscordClient).mockRejectedValue(new Error('Connection failed'));

    // Act
    const result = await myTool.execute({ input: 'test' });

    // Assert
    expect(result.error).toBeDefined();
  });
});
```

## CI Integration

Tests run automatically on every push and PR via GitHub Actions.

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
```

## Future Improvements

1. **E2E Testing Infrastructure**
   - Set up test Discord server
   - Create test GitHub organization
   - Implement test data fixtures

2. **Snapshot Testing**
   - Test agent response formats
   - Catch unexpected output changes

3. **Coverage Thresholds**
   - Enforce minimum coverage percentage
   - Track coverage trends over time

4. **Performance Testing**
   - Measure tool execution time
   - Catch performance regressions

## Related Documentation

- [Testing Strategy](../data/shared/testing-strategy.md) - Team-wide testing philosophy
- [Vitest Documentation](https://vitest.dev/) - Testing framework docs
