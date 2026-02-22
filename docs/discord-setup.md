# Discord Setup Guide

This guide walks you through setting up a Discord server for the autonomous dev team agents.

## 1. Create a Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Name it "Agent Dev Crew" (or your preferred name)
4. Click "Create"

## 2. Create the Bot

1. In your application, go to the "Bot" section
2. Click "Add Bot"
3. Under "Privileged Gateway Intents", enable:
   - **Server Members Intent**
   - **Message Content Intent**
4. Click "Reset Token" and save the token securely (you'll need it for `DISCORD_TOKEN`)

## 3. Configure Bot Permissions

The bot needs these permissions:
- Read Messages/View Channels
- Send Messages
- Read Message History
- Add Reactions (optional, for acknowledgments)

The bot permission integer is: `68608`

## 4. Invite the Bot to Your Server

1. Go to "OAuth2" > "URL Generator"
2. Under "Scopes", select:
   - `bot`
   - `applications.commands` (optional, for future slash commands)
3. Under "Bot Permissions", select the permissions from step 3
4. Copy the generated URL and open it in a browser
5. Select your server and authorize the bot

## 5. Create Discord Channels

Create the following text channels in your server:

| Channel | Purpose |
|---------|---------|
| `#development` | Product discussions, feature requests, PO communication |
| `#dev-chat` | Developer discussions, implementation updates |
| `#incidents` | Production incidents and urgent issues |

## 6. Create Roles

Create the following roles for agent mentions:

| Role | Purpose |
|------|---------|
| `@po` | Product Owner agent |
| `@dev` | Developer agent |
| `@qa` | QA agent (future) |
| `@sre` | SRE agent (future) |
| `@aleksandar` | Human escalation point |

Assign the `@po` and `@dev` roles to the bot user.

## 7. Get the Guild ID

1. Enable Developer Mode in Discord:
   - Go to User Settings > App Settings > Advanced
   - Enable "Developer Mode"
2. Right-click on your server name in the server list
3. Click "Copy Server ID"
4. Save this as `DISCORD_GUILD_ID`

## 8. Environment Variables

Add these to your `.env` file:

```env
DISCORD_TOKEN=your-bot-token-here
DISCORD_GUILD_ID=your-guild-id-here
```

## 9. Verify Setup

Test the bot connection:

```bash
# Build and run
npm run build
AGENT_NAME=po npm start
```

You should see logs indicating the Discord client connected successfully.

## Troubleshooting

### Bot not responding to mentions

1. Verify the bot has the correct permissions in the channel
2. Check that Message Content Intent is enabled in Developer Portal
3. Ensure the bot is assigned the role being mentioned

### "Guild not found" error

1. Verify `DISCORD_GUILD_ID` is correct
2. Ensure the bot has been invited to the server
3. Check the bot has permissions to view channels

### Rate limiting

Discord has rate limits. If you see rate limit errors:
- The system automatically handles retries
- Consider increasing polling intervals in agent config
