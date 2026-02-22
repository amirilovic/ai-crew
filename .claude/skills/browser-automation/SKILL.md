---
name: browser-automation
description: This skill should be used when the user asks to "test in browser", "open a webpage", "take a screenshot", "fill a form", "E2E test", "verify in browser", "check the UI", "test the frontend", or needs to interact with a web application. Provides browser automation capabilities via the `agent-browser` CLI.
---

# Browser Automation Skill

Use `agent-browser` CLI for browser automation, E2E testing, and web interactions.

## Quick Start

```bash
# Open a webpage
agent-browser open https://example.com

# Take a screenshot
agent-browser screenshot /tmp/screenshot.png

# Get interactive elements
agent-browser snapshot -i
```

## Common Workflows

### 1. Test a signup/login form

```bash
agent-browser open https://app.example.com/signup
agent-browser snapshot -i                        # See form elements
agent-browser fill @e1 "test@example.com"        # Fill email
agent-browser fill @e2 "password123"             # Fill password
agent-browser click @e3                          # Click submit
agent-browser wait 2000                          # Wait for response
agent-browser screenshot /tmp/result.png         # Capture result
agent-browser get url                            # Check final URL
```

### 2. Verify page content

```bash
agent-browser open https://example.com
agent-browser snapshot                           # Get page content
agent-browser get title                          # Get page title
agent-browser get text @e1                       # Get element text
```

### 3. Debug network requests

```bash
agent-browser open https://example.com
# Fill and submit form...
agent-browser eval "JSON.stringify(performance.getEntriesByType('resource').filter(r => r.name.includes('api')).map(r => ({name: r.name})))"
```

## Element Selection

- **Refs**: `@e1`, `@e2` (from snapshot output)
- **CSS**: `#id`, `.class`, `button[type=submit]`
- **Text**: `text=Login`, `text="Submit Form"`

## Key Commands

| Command | Description |
|---------|-------------|
| `open <url>` | Navigate to URL |
| `snapshot -i` | Get interactive elements |
| `screenshot <path>` | Capture screenshot |
| `fill <selector> <text>` | Fill input field |
| `click <selector>` | Click element |
| `wait <ms>` | Wait milliseconds |
| `get url` | Get current URL |
| `get title` | Get page title |
| `eval <js>` | Execute JavaScript |

## Tips

1. **Always snapshot first** before interacting with elements
2. **Use `-i` flag** to see only interactive elements
3. **Take screenshots** to verify state after actions
4. **Element refs change** after page updates - re-snapshot
5. **Use sessions** for multi-step workflows: `agent-browser --session name open ...`

## When to Use

Use browser automation for:
- E2E testing signup/login flows
- Verifying UI changes
- Testing form submissions
- Checking page rendering
- Debugging frontend issues

Don't use when:
- Simple API test suffices (use curl)
- Checking static content (use WebFetch)
