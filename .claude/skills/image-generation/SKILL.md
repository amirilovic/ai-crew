---
name: image-generation
description: Use this skill when asked to "generate an image", "create a picture", "make an illustration", "draw something", or when visual content needs to be created. Provides image generation via the gen-image CLI tool.
---

# Image Generation Skill

Use `gen-image` CLI to generate images with OpenAI's gpt-image-1 model.

## Quick Start

```bash
# Basic image generation
gen-image "A cat wearing sunglasses"

# With options
gen-image -q low -s square -o /tmp "Your prompt"
```

## Common Options

| Flag | Description | Values |
|------|-------------|--------|
| `-q` | Quality | `low` ($0.01), `medium` ($0.04), `high` ($0.17) |
| `-s` | Size | `square`, `portrait`, `landscape` |
| `-o` | Output dir | Path (default: current dir) |
| `-t` | Transparent | Enable transparent background |
| `-n` | Count | Number of images to generate |

## Workflow

1. **Generate image:**
   ```bash
   gen-image -q low -s square -o /tmp "Your prompt"
   ```

2. **Find the output file:**
   ```bash
   ls -t /tmp/generated_output_*.png | head -1
   ```

3. **View image** (use Read tool on the file path)

4. **Send to Discord** (use discord_send_file tool)

## Tips

- **Start with `low` quality** for testing - upgrade only when needed
- **Be specific in prompts** - detailed prompts give better results
- **Use `/tmp` for output** - keeps generated images temporary
- Prefer `gpt-image-1` model (DALL-E being deprecated May 2026)

## Size Reference

| Alias | Dimensions | Best For |
|-------|------------|----------|
| `square` | 1024x1024 | Icons, avatars |
| `portrait` | 1024x1536 | Mobile, posters |
| `landscape` | 1536x1024 | Desktop, banners |
