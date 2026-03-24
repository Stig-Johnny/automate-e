---
title: Quick Start
---

# Quick Start

Get an Automate-E agent running in 5 minutes. You'll start with test mode (no Discord needed), then optionally connect to Discord.

## Prerequisites

- [Node.js 20+](https://nodejs.org/)
- An [Anthropic API key](https://console.anthropic.com/) (free tier works)

## Step 1: Clone and Install

```bash
git clone https://github.com/Stig-Johnny/automate-e.git
cd automate-e
npm install
```

## Step 2: Create Your Agent

Create a file called `character.json` in the project root:

```json
{
  "name": "My-Agent",
  "bio": "A helpful assistant",
  "personality": "You are a helpful assistant. Answer questions clearly and concisely.",
  "lore": [
    "You help users with general questions",
    "You are running on the Automate-E agent runtime"
  ],
  "tools": [],
  "discord": {
    "channels": ["#general"]
  },
  "llm": {
    "model": "claude-haiku-4-5",
    "temperature": 0.5
  }
}
```

This is all you need:

- `personality` — the system prompt that defines how the agent behaves
- `lore` — background facts the agent knows (injected into the system prompt as bullet points)
- `tools` — HTTP APIs the agent can call (empty for now, we'll add some in Step 5)

## Step 3: Try It (Test Mode)

Test mode gives you a web chat interface — no Discord bot needed. Run this in your terminal:

```bash
CHARACTER_FILE=./character.json ANTHROPIC_API_KEY=sk-ant-...your-key... npm test
```

!!! tip "All on one line"
    The env vars and command must be in the same line (or exported in the same shell session). Replace `sk-ant-...your-key...` with your actual Anthropic API key.

You should see:

```
[Automate-E] Loaded character: My-Agent
[Automate-E] My-Agent test mode running at http://localhost:3000
[Automate-E] No Discord — chat via the web interface
```

Open [http://localhost:3000](http://localhost:3000) in your browser. Type a message and hit Send — your agent responds using Claude. The sidebar shows token usage and logs in real-time.

![Test Mode](images/test-mode.png)

Type a message and hit Send. Your agent responds using Claude.

## Step 4: Connect to Discord (Optional)

When you're ready to put your agent on Discord:

### 4a. Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name
3. Go to **Bot** tab
4. Click **Reset Token** and copy it -- this is your `DISCORD_BOT_TOKEN`
5. Under **Privileged Gateway Intents**, enable:
    - **Message Content Intent** (required -- the bot needs to read messages)
6. Go to **Installation** tab, set Install Link to **None**
7. Go back to **Bot** tab, disable **Public Bot** (only you can add it to servers)

### 4b. Invite the Bot to Your Server

1. Go to **OAuth2** tab
2. Under **OAuth2 URL Generator**, select scopes: `bot`
3. Under **Bot Permissions**, select:
    - Send Messages
    - Create Public Threads
    - Send Messages in Threads
    - Read Message History
    - View Channels
4. Copy the generated URL and open it in your browser
5. Select your Discord server and authorize

### 4c. Run the Agent

```bash
export CHARACTER_FILE=./character.json
export DISCORD_BOT_TOKEN=your-bot-token
export ANTHROPIC_API_KEY=sk-ant-...your-key...

npm start
```

The agent connects to Discord, listens on the channels defined in `character.json`, and creates a thread for each conversation.

## Step 5: Add Tools

Give your agent access to any HTTP API. Add entries to the `tools` array in `character.json`:

Here's a working example using [wttr.in](https://wttr.in) (free, no API key needed):

```json
{
  "tools": [
    {
      "url": "https://wttr.in",
      "endpoints": [
        {
          "method": "GET",
          "path": "/London",
          "description": "Get current weather for London in plain text format. Add ?format=j1 as query for JSON."
        }
      ]
    }
  ]
}
```

Try asking your agent "What's the weather in London?" — it will call the tool and summarize the result.

Each endpoint in `character.json` becomes a tool that Claude can call. You can point to any HTTP API your agent needs.

## Step 6: Add Memory (Optional)

By default, conversations are stored in memory and lost on restart. For persistent memory, provide a Postgres connection:

```bash
export DATABASE_URL=postgresql://user:pass@localhost:5432/agent
```

The agent stores conversations, learned facts about users, and patterns it discovers. See [Memory](memory.md) for details.

## Using Docker

You can also run with Docker instead of Node.js directly:

```bash
# Test mode
docker run --rm -p 3000:3000 \
  -e CHARACTER_FILE=/config/character.json \
  -e ANTHROPIC_API_KEY=sk-ant-...your-key... \
  -v $(pwd)/character.json:/config/character.json:ro \
  ghcr.io/stig-johnny/automate-e:latest node src/test.js

# Discord mode
docker run -d --name my-agent \
  -e CHARACTER_FILE=/config/character.json \
  -e DISCORD_BOT_TOKEN=your-bot-token \
  -e ANTHROPIC_API_KEY=sk-ant-...your-key... \
  -v $(pwd)/character.json:/config/character.json:ro \
  ghcr.io/stig-johnny/automate-e:latest
```

## Troubleshooting

**"EADDRINUSE: port 3000 already in use"**
: Another process is using port 3000. Use a different port: `PORT=3001 CHARACTER_FILE=./character.json ANTHROPIC_API_KEY=... npm test`

**API calls fail with "Error" in chat**
: Check that `ANTHROPIC_API_KEY` is set correctly. The agent starts without it, but API calls will fail when you send a message.

**"An invalid token was provided"**
: Your Discord bot token is wrong or expired. Go to the Developer Portal, reset the token, and copy the new one.

**"TokenInvalid" crash on startup**
: This happens in `npm start` mode if the Discord token is missing. Use `npm test` for test mode without Discord.

**Bot is online but doesn't respond**
: Check that **Message Content Intent** is enabled in the Developer Portal (Bot tab). Without it, the bot can't read messages.

**Bot responds in the wrong channel**
: The `discord.channels` array in character.json must match your channel names exactly, with the `#` prefix: `["#general"]`.

**"429 Too Many Requests" from Anthropic**
: You've hit the API rate limit. Wait a minute and try again, or upgrade your Anthropic plan.

**npm audit shows vulnerabilities**
: Known issue with `discord.js` dependency (`undici`). Not a risk for local development. For production, monitor and update when fixes are released.

## Next Steps

- [Configuration Reference](configuration.md) -- all character.json fields
- [Architecture](architecture.md) -- how the agent loop works
- [Deployment](deployment.md) -- deploy to Kubernetes with Helm
- [Dashboard](dashboard.md) -- live monitoring
