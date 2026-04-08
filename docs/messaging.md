---
title: Multi-Platform Messaging
---

# Multi-Platform Messaging

Automate-E supports multiple messaging platforms. Agents work on Discord or Slack without code changes — just configure `messaging.platform` in `character.json`.

## Supported Platforms

| Platform | Entry Point | Auth | Status |
|----------|------------|------|--------|
| Discord | `index.js` (v1) or `index-v2.js` | `DISCORD_BOT_TOKEN` | Production |
| Slack | `index-v2.js` | `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` | Production |

## Configuration

### New-style (recommended)

Use the `messaging` field for platform-agnostic configuration:

```json
{
  "messaging": {
    "platform": "slack",
    "config": {
      "channels": {
        "general": "my-channel"
      }
    }
  }
}
```

### Legacy (Discord-only)

The `discord` field still works for backward compatibility:

```json
{
  "discord": {
    "channels": ["#my-channel"],
    "threadMode": "per-user",
    "allowBots": []
  }
}
```

If both `messaging` and `discord` are present, `messaging` takes precedence.

## Discord Setup

See [Discord Setup](discord-setup.md) for the full guide.

**Required env vars:**

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Bot token from Discord Developer Portal |

**Required scopes:** `bot` with permissions: Send Messages, Read Message History, Create Public Threads, Manage Threads, Add Reactions.

**Required intents:** Message Content, Server Members (privileged).

## Slack Setup

### 1. Create Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name your app (e.g., `Conductor-E`), select workspace

### 2. Enable Socket Mode

1. **Socket Mode** → Enable
2. Create App-Level Token with scope `connections:write`
3. Save the `xapp-...` token

### 3. Bot Permissions

**OAuth & Permissions** → Bot Token Scopes:

- `chat:write` — Send messages
- `channels:read` — Read public channel info
- `channels:history` — Read public channel messages
- `users:read` — Get user display names
- `app_mentions:read` — Respond to @mentions

For private channels, also add:

- `groups:read`
- `groups:history`

### 4. Event Subscriptions

**Event Subscriptions** → Enable → **Subscribe to bot events:**

- `message.channels` — Messages in public channels
- `app_mention` — When someone @mentions the bot

For private channels, also add:

- `message.groups`

### 5. Install to Workspace

**Install App** → Install to Workspace → Copy the `xoxb-...` Bot User OAuth Token.

### 6. Invite Bot to Channel

In Slack: `/invite @YourBot` in the target channel.

**Required env vars:**

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | `xoxb-...` Bot User OAuth Token |
| `SLACK_APP_TOKEN` | `xapp-...` App-Level Token (Socket Mode) |

## Helm Values

### Discord Agent

```yaml
messagingPlatform: discord  # or omit (default)

secrets:
  existingSecret: my-agent-secrets
  # Secret must contain: discord-bot-token plus the provider credential you use
  # (anthropic-api-key for Anthropic / Claude CLI, openai-api-key for Codex CLI with API key auth)
```

### Slack Agent

```yaml
messagingPlatform: slack
command: ["node", "src/index-v2.js"]

secrets:
  existingSecret: my-agent-secrets
  # Secret must contain: slack-bot-token, slack-app-token, and the provider credential you use
```

### Kubernetes Secret

```bash
kubectl create secret generic my-agent-secrets \
  --from-literal=slack-bot-token='xoxb-...' \
  --from-literal=slack-app-token='xapp-...' \
  --from-literal=anthropic-api-key='sk-ant-...' \
  --from-literal=openai-api-key='sk-...' \
  --from-literal=database-url=''
```

## Architecture

The messaging layer uses an adapter pattern:

```
character.json → messaging.platform
                      │
              ┌───────┴───────┐
              ▼               ▼
        Discord Adapter   Slack Adapter
        (discord.js)      (@slack/bolt)
              │               │
              └───────┬───────┘
                      ▼
              Message Handler
              (platform-agnostic)
                      │
                      ▼
                Agent Loop
                (agent.js)
```

Both adapters expose the same interface:

- `connect()` — Connect to the platform
- `onMessage(handler)` — Register message handler
- `sendReply(context, text)` — Reply in thread
- `sendToChannel(channel, text)` — Send to a channel
- `disconnect()` — Clean shutdown

The agent loop (`agent.js`) never touches platform-specific code.

## Entry Points

| File | Messaging | Use When |
|------|-----------|----------|
| `index.js` | Discord only (hardcoded) | Existing Discord agents (backward compat) |
| `index-v2.js` | Multi-platform (adapter) | New agents, or when using Slack |
| `gateway.js` | Discord only (split mode) | High-traffic Discord agents with Redis |

`index-v2.js` will become the default `index.js` in a future release once all existing agents are migrated.
