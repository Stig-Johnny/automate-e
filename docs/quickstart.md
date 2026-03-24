---
title: Quick Start
---

# Quick Start

Get an Automate-E agent running locally in 5 minutes.

## Prerequisites

- Node.js 20+
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- An Anthropic API key ([console.anthropic.com](https://console.anthropic.com))

## 1. Create a Character File

Create `character.json`:

```json
{
  "name": "My-Agent",
  "bio": "A helpful assistant",
  "personality": "You are a helpful assistant. Be concise and accurate.",
  "lore": [
    "You help users with general questions"
  ],
  "tools": [],
  "discord": {
    "channels": ["#general"]
  },
  "llm": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "temperature": 0.3
  }
}
```

## 2. Run with Docker

```bash
docker run -d \
  --name my-agent \
  -e CHARACTER_FILE=/config/character.json \
  -e DISCORD_BOT_TOKEN=<your-token> \
  -e ANTHROPIC_API_KEY=<your-key> \
  -v $(pwd)/character.json:/config/character.json:ro \
  ghcr.io/stig-johnny/automate-e:latest
```

The agent connects to Discord and starts responding in the configured channels.

## 3. Run Locally (Development)

```bash
git clone https://github.com/Stig-Johnny/automate-e.git
cd automate-e
npm install

export CHARACTER_FILE=./character.json
export DISCORD_BOT_TOKEN=<your-token>
export ANTHROPIC_API_KEY=<your-key>

npm start
```

## 4. Add Tools

Give the agent access to HTTP APIs by adding entries to the `tools` array:

```json
{
  "tools": [
    {
      "url": "http://localhost:8080",
      "endpoints": [
        {
          "method": "GET",
          "path": "/weather",
          "description": "Get current weather for a city"
        }
      ]
    }
  ]
}
```

Claude sees these as callable tools and invokes them when relevant.

## 5. Add Memory (Optional)

For persistent memory across restarts, provide a Postgres connection:

```bash
export DATABASE_URL=postgresql://user:pass@localhost:5432/agent
```

Without `DATABASE_URL`, the agent uses in-memory storage (lost on restart).

## Next Steps

- [Configuration Reference](configuration.md) -- all character.json fields
- [Deployment](deployment.md) -- deploy to Kubernetes
- [Memory](memory.md) -- how persistent memory works
