# GitHub Setup Guide

This guide walks you through setting up GitHub for the autonomous dev team agents.

## Prerequisites

- GitHub CLI (`gh`) installed: `brew install gh` or see [cli.github.com](https://cli.github.com/)
- A GitHub account with repository access

## 1. Create a Repository

Create a new repository for your project:

```bash
gh repo create my-project --public --clone
cd my-project
```

Or use an existing repository.

## 2. Create a Personal Access Token (Classic)

1. Go to [GitHub Settings > Developer settings > Personal access tokens > Tokens (classic)](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Name: "Agent Dev Crew"
4. Expiration: Set as needed (recommend 90 days minimum)
5. Select scopes:
   - `repo` (Full control of private repositories)
   - `project` (Full control of projects)
   - `read:org` (Read org membership, if using organization)
6. Click "Generate token"
7. Copy and save the token securely

## 3. Configure gh CLI

Authenticate the gh CLI with your token:

```bash
gh auth login
```

Or set the token as an environment variable:

```bash
export GH_TOKEN=ghp_your_token_here
```

## 4. Create a GitHub Project Board

Create a project board for task management:

```bash
# Create a new project
gh project create --owner YOUR_USERNAME --title "Dev Team Board"

# Note the project number from the output
```

Or use the GitHub UI:
1. Go to your profile or organization
2. Click "Projects" tab
3. Click "New project"
4. Choose "Board" template
5. Name it "Dev Team Board"

## 5. Configure Project Columns

The project should have these status columns:

| Status | Purpose |
|--------|---------|
| Backlog | New items not yet prioritized |
| Ready for Dev | Prioritized and ready for development |
| In Progress | Currently being worked on |
| In Review | PR created, awaiting review |
| Done | Completed and merged |

To add/configure columns via CLI:

```bash
# List existing fields
gh project field-list PROJECT_NUMBER --owner OWNER

# The Status field should already exist with Single Select type
# You can add options via the GitHub UI
```

## 6. Create Issue Labels

Create labels for categorizing issues:

```bash
# Feature label
gh label create feature --color 0E8A16 --description "New feature or enhancement"

# Bug label
gh label create bug --color D73A4A --description "Something isn't working"

# Priority labels
gh label create p1 --color B60205 --description "Critical priority"
gh label create p2 --color FBCA04 --description "High priority"
gh label create p3 --color 0E8A16 --description "Normal priority"

# Urgent label
gh label create urgent --color D93F0B --description "Needs immediate attention"
```

## 7. Verify Setup

Test the GitHub integration:

```bash
# Test issue creation
gh issue create --title "Test issue" --body "Testing agent setup" --label "feature"

# List issues
gh issue list --json number,title,state

# Test project access
gh project item-list PROJECT_NUMBER --owner OWNER --format json

# Clean up test issue
gh issue close ISSUE_NUMBER
gh issue delete ISSUE_NUMBER --yes
```

## 8. Get Project IDs (for item-edit)

To move items between columns, you need the project ID and field option IDs:

```bash
# Get project ID
gh project list --owner OWNER --format json

# Get field IDs
gh project field-list PROJECT_NUMBER --owner OWNER --format json
```

Save these IDs for reference when moving items programmatically.

## Common gh CLI Commands

### Issues

```bash
# Create issue
gh issue create --title "Title" --body "Body" --label "feature"

# List issues
gh issue list --json number,title,state,labels

# View issue
gh issue view 123 --json body,comments

# Comment on issue
gh issue comment 123 --body "Comment text"

# Close issue
gh issue close 123
```

### Pull Requests

```bash
# Create PR
gh pr create --title "Title" --body "Body" --head feature-branch

# List PRs
gh pr list --json number,title,state

# View PR
gh pr view 123 --json additions,deletions,files

# Merge PR
gh pr merge 123 --squash
```

### Project Board

```bash
# List items
gh project item-list PROJECT_NUMBER --owner OWNER --format json

# Add issue to project
gh project item-add PROJECT_NUMBER --owner OWNER --url https://github.com/OWNER/REPO/issues/123

# Edit item (move to different status)
gh project item-edit --project-id PROJECT_ID --id ITEM_ID --field-id FIELD_ID --single-select-option-id OPTION_ID
```

## Troubleshooting

### "Permission denied" errors

1. Verify token has correct scopes (`repo`, `project`)
2. Check token hasn't expired
3. Ensure you have write access to the repository

### Project board not updating

1. Check project permissions allow the token to modify items
2. Use `gh project view` to verify access

### gh CLI not authenticated

```bash
# Check authentication status
gh auth status

# Re-authenticate if needed
gh auth login
```
