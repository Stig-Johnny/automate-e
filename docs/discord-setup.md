---
title: Discord Bot Setup
---

# Discord Bot Setup

Detailed guide for creating and configuring a Discord bot for Automate-E.

## Create the Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application**
3. Name it (e.g., "My Agent") and click Create

## Get the Bot Token

1. Go to the **Bot** tab in the left sidebar
2. Click **Reset Token**
3. Copy the token -- you'll need this as `DISCORD_BOT_TOKEN`
4. **Never share this token or commit it to git**

## Enable Required Intents

Still on the **Bot** tab, scroll down to **Privileged Gateway Intents** and enable:

- **Message Content Intent** -- required for the bot to read message text

Without this, the bot connects but can't see what users write.

## Disable Public Access

To prevent random users from adding your bot to their servers:

1. Go to the **Installation** tab
2. Set **Install Link** to **None**
3. Go back to the **Bot** tab
4. Disable **Public Bot**

## Invite to Your Server

1. Go to the **OAuth2** tab
2. In **OAuth2 URL Generator**, check the `bot` scope
3. Under **Bot Permissions**, select:
    - View Channels
    - Send Messages
    - Create Public Threads
    - Send Messages in Threads
    - Read Message History
4. Copy the generated URL
5. Open it in your browser, select your server, and authorize

## Configure the Agent

In your `character.json`, set the channels the bot should listen on:

```json
{
  "discord": {
    "channels": ["#general", "#support"]
  }
}
```

Channel names must match exactly, with the `#` prefix.

### Thread Mode

When someone sends a message in a monitored channel, the bot creates a thread for the conversation. This keeps the main channel clean and gives each conversation its own context.

### DM Support

The bot automatically responds to direct messages. No configuration needed.

### Allow Other Bots

By default, the bot ignores messages from other bots. To allow specific bots:

```json
{
  "discord": {
    "allowBots": ["123456789012345678"]
  }
}
```

Use the bot's user ID (not application ID). You can find this by enabling Developer Mode in Discord, then right-clicking the bot user.

## Run the Agent

```bash
export CHARACTER_FILE=./character.json
export DISCORD_BOT_TOKEN=your-token-here
export ANTHROPIC_API_KEY=sk-ant-...

npm start
```

You should see:

```
[Automate-E] Loaded character: My Agent
[Automate-E] Logged in as My Agent#1234
[Automate-E] Listening on channels: #general, #support
[Automate-E] DMs: enabled
```

Send a message in one of the configured channels -- the bot creates a thread and responds.
