# GitHub Secrets Management Guide

All agents have permission to add secrets to GitHub repositories. This guide explains how to do it.

## Adding Repository Secrets via CLI

```bash
# Add a secret to a repository
gh secret set SECRET_NAME --body "secret-value" --repo owner/repo

# Or read from a file
gh secret set SECRET_NAME < secret-file.txt --repo owner/repo

# Set from environment variable
gh secret set SECRET_NAME --body "$SECRET_VALUE" --repo owner/repo
```

## Adding Repository Secrets via Web UI

1. Go to the repository on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Enter the secret name and value
5. Click **Add secret**

## Common Secrets

| Secret Name | Description | Used By |
|-------------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for chat features | JRD builder |
| `BETTER_AUTH_SECRET` | Better Auth session secret | JRD auth |
| `DATABASE_URL` | PostgreSQL connection string | JRD database |

## Security Notes

- **Never log secret values** - they will be exposed in CI logs
- **Never commit secrets** to the repository
- Secrets are encrypted and only exposed to GitHub Actions workflows
- Use environment-specific secrets when needed (staging vs production)

## Using Secrets in GitHub Actions

Secrets are available in workflows via `${{ secrets.SECRET_NAME }}`:

```yaml
env:
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## Using Secrets in Helm Deployments

Pass secrets via `--set` during helm upgrade:

```bash
helm upgrade jrd-app ./helm/jrd-app \
  --set secrets.openaiApiKey="${{ secrets.OPENAI_API_KEY }}" \
  --set secrets.databaseUrl="${{ secrets.DATABASE_URL }}"
```

## Troubleshooting

**Secret not available in workflow?**
- Check the secret exists in the correct repository
- Verify the workflow has access (check repository settings)
- Ensure the secret name matches exactly (case-sensitive)

**Secret appears as `***` in logs?**
- This is expected! GitHub automatically masks secret values in logs
