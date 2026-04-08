---
title: Configuration Reference
---

# Configuration Reference

Agents are defined by a single `character.json` file. This page documents every field.

## Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Agent display name (used in logs and dashboard) |
| `bio` | string | Yes | One-line description of the agent's purpose |
| `personality` | string | Yes | System prompt injected into every Claude request |
| `lore` | string[] | No | Background facts appended to the system prompt |
| `style` | object | No | Output style preferences |
| `messageExamples` | object[] | No | Few-shot examples for consistent behavior |
| `tools` | object[] | No | HTTP APIs the agent can call |
| `mcpServers` | object | No | MCP servers the agent can use as tools |
| `messaging` | object | No | Multi-platform messaging config (see [Messaging](messaging.md)). Overrides `discord`. |
| `discord` | object | No | Discord connection settings (legacy, use `messaging` for new agents) |
| `memory` | object | No | Memory retention policies |
| `llm` | object | Yes | LLM provider and model settings |

## `personality`

The core system prompt. This is the most important field -- it defines who the agent is and how it behaves.

```json
{
  "personality": "You are a helpful assistant.\nYou answer questions and help users with tasks.\nYou are concise and professional."
}
```

!!! tip
    Use `\n` for line breaks. Keep it under 2000 characters. Put detailed knowledge in `lore` instead.

## `lore`

An array of facts the agent should know. Each entry is appended to the system prompt as context.

```json
{
  "lore": [
    "The API returns JSON responses",
    "Users can ask questions in any language",
    "All actions are logged for audit purposes"
  ]
}
```

## `style`

Controls the agent's output format.

```json
{
  "style": {
    "language": "English",
    "tone": "professional but friendly",
    "format": "concise"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `language` | string | `"English"` | Preferred response language |
| `tone` | string | `"neutral"` | Communication tone |
| `format` | string | `"plain"` | Output formatting rules |

## `messageExamples`

Few-shot examples that guide Claude's response style. Each example has a `user` message and an `agent` response.

```json
{
  "messageExamples": [
    {
      "user": "What's the status of order #123?",
      "agent": "Order #123 is currently in transit. Expected delivery: tomorrow."
    }
  ]
}
```

## `tools`

HTTP APIs the agent can call via Claude's tool use. Each tool group has a base URL and a list of endpoints.

```json
{
  "tools": [
    {
      "url": "http://my-api.default.svc.cluster.local",
      "endpoints": [
        {
          "method": "GET",
          "path": "/orders",
          "description": "List orders by status"
        },
        {
          "method": "GET",
          "path": "/orders/:id",
          "description": "Get order details by ID"
        }
      ]
    }
  ]
}
```

### Tool Endpoint Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | string | Yes | HTTP method: `GET`, `POST`, `PUT`, `DELETE` |
| `path` | string | Yes | URL path appended to the group's `url` |
| `description` | string | Yes | Shown to Claude as the tool description |

The runtime converts each endpoint into a Claude tool. The tool name is derived from `method + path` (e.g., `get_folio_balance`). Claude decides when to call tools based on the description.

## `mcpServers`

[Model Context Protocol](https://modelcontextprotocol.io/) servers the agent can use as tools. Each server is spawned as a child process via stdio.

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@latest"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"]
    }
  }
}
```

### MCP Server Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| *(key)* | string | Yes | Server name (used as tool name prefix) |
| `command` | string | Yes | Command to spawn the server process |
| `args` | string[] | No | Arguments passed to the command |
| `env` | object | No | Additional environment variables for the server process |

MCP tools are prefixed with `mcp_{serverName}_` to avoid name collisions with HTTP tools. For example, a tool named `resolve-library-id` from the `context7` server becomes `mcp_context7_resolve-library-id`.

MCP servers are connected on agent startup and disconnected on shutdown. If a server fails to connect, the agent continues without it.

## `messaging`

Multi-platform messaging configuration. See [Messaging](messaging.md) for full setup guides.

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

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | Yes | `"discord"` or `"slack"` |
| `config.channels` | object or array | Yes | Channels the agent listens on |

!!! note
    Requires `index-v2.js` entry point. Set `command: ["node", "src/index-v2.js"]` in Helm values.

## `discord`

Discord connection and routing settings. Used by the legacy `index.js` entry point, or when `messaging.platform` is `"discord"`.

```json
{
  "discord": {
    "channels": ["#support"],
    "threadMode": "per-user",
    "allowBots": []
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `channels` | string[] | `[]` | Channel names the agent listens on. Empty = all channels. |
| `threadMode` | string | `"none"` | `"none"`, `"per-document"`, or `"per-user"` |
| `allowBots` | string[] | `[]` | Bot user IDs whose messages the agent should process |

### Thread Modes

| Mode | Behavior |
|------|----------|
| `none` | Reply directly in the channel |
| `per-document` | Create a new thread for each document/attachment |
| `per-user` | Create one thread per user (reuse existing) |

## `memory`

Retention policies for the memory system. See [Memory](memory.md) for details.

```json
{
  "memory": {
    "conversationRetention": "30d",
    "patternRetention": "indefinite",
    "historyRetention": "5y"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `conversationRetention` | string | `"30d"` | How long to keep conversation messages |
| `patternRetention` | string | `"indefinite"` | How long to keep learned patterns |
| `historyRetention` | string | `"indefinite"` | How long to keep audit history |

Duration format: `"30d"` (days), `"1y"` (years), `"indefinite"`.

## `llm`

LLM provider configuration.

```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "temperature": 0.3,
    "maxTokens": 4096
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | string | `"anthropic"` | LLM provider: `"anthropic"`, `"claude-cli"`, or `"codex-cli"` |
| `fallbackProviders` | string[] | `[]` | Ordered fallback providers to try if the primary provider fails |
| `providers` | object | `{}` | Provider-specific overrides keyed by provider name |
| `model` | string | `"claude-haiku-4-5-20251001"` | Model identifier passed to the selected provider |
| `temperature` | number | `0.3` | Response randomness (0.0 = deterministic, 1.0 = creative) |
| `maxTokens` | number | `4096` | Maximum tokens per Anthropic SDK response. |
| `maxTurns` | number | `10` | Maximum turns for CLI providers (`claude-cli`, `codex-cli`). |
| `timeoutMs` | number | `300000` | CLI timeout in milliseconds for CLI providers. |
| `search` | boolean | `false` | Enables Codex web search when `provider` is `codex-cli`. |

Notes:

- `anthropic` uses the Anthropic SDK and `ANTHROPIC_API_KEY`.
- `claude-cli` uses the local `claude` command. OAuth subscription tokens (`sk-ant-oat...`) automatically route to this mode.
- `codex-cli` uses the local `codex` command.
- `llm.authMode: device-auth` tells the runtime to require `codex login --device-auth` and surface the login URL/code through progress messages before running a turn.
- Without `llm.authMode: device-auth`, `codex-cli` uses the existing environment, which can be either a stored Codex login or `OPENAI_API_KEY`.
- `fallbackProviders` lets one agent try multiple providers in order. This is useful when you want Codex and Claude Code available at the same time with automatic failover.
- `providers.{name}` can override provider-specific settings such as `model`, `timeoutMs`, `maxTurns`, or `authMode` without duplicating the entire `llm` block.

Example with Codex primary and Claude Code fallback:

```json
{
  "llm": {
    "provider": "codex-cli",
    "fallbackProviders": ["claude-cli"],
    "providers": {
      "codex-cli": {
        "model": "gpt-5.4",
        "authMode": "device-auth"
      },
      "claude-cli": {
        "model": "claude-sonnet-4-5",
        "maxTurns": 10
      }
    }
  }
}
```

## `cron`

Configuration for one-shot cron mode. When set, the agent can run on a schedule via `node src/run-once.js`, executing the prompt and posting results to a Discord webhook.

```json
{
  "cron": {
    "prompt": "Check all open PRs and report any that need attention."
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | The prompt to execute on each cron run |

The cron schedule itself is configured in the Helm chart (`cron.schedule`), not in `character.json`. Results are posted to the `DISCORD_WEBHOOK_URL` environment variable if set.

## `webhooks`

Receive real-time HTTP events from external systems (e.g., GitHub webhooks). Each source gets a `POST /webhook/{source}` endpoint on the dashboard HTTP server.

```json
{
  "webhooks": {
    "github": {
      "secret": "env:GITHUB_WEBHOOK_SECRET"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| *(key)* | string | Yes | Source name (used in URL path) |
| `secret` | string | No | HMAC-SHA256 secret. Prefix with `env:` to read from environment variable. |

Events are verified via `X-Hub-Signature-256` header (GitHub HMAC). If no secret is configured, verification is skipped.

**Supported GitHub events:** `pull_request`, `pull_request_review`, `check_suite`, `check_run`, `issues`, `issue_comment`, `push`

The webhook event is formatted into a concise prompt and processed through the agent loop. In split mode, events are queued via Redis Stream (same as Discord messages). Responses are posted to `DISCORD_WEBHOOK_URL`.

## Environment Variables

These are set on the container, not in `character.json`.

| Variable | Required | Description |
|----------|----------|-------------|
| `CHARACTER_FILE` | Yes | Path to `character.json` (e.g., `/config/character.json`) |
| `DISCORD_BOT_TOKEN` | Discord agents | Discord bot token |
| `SLACK_BOT_TOKEN` | Slack agents | Slack Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Slack agents | Slack App-Level Token for Socket Mode (`xapp-...`) |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `DATABASE_URL` | No | Postgres connection string. Omit for in-memory mode. |
| `DISCORD_WEBHOOK_URL` | No | Discord webhook URL for cron mode output. |
| `GITHUB_WEBHOOK_SECRET` | No | HMAC secret for GitHub webhook verification. |
| `DASHBOARD_PORT` | No | Dashboard HTTP port (default: `3000`) |

## Full Example

```json
{
  "name": "My Agent",
  "bio": "A helpful support assistant",
  "personality": "You are a helpful assistant that answers questions...",
  "lore": [
    "The API uses REST conventions",
    "All timestamps are in UTC"
  ],
  "style": {
    "language": "English",
    "tone": "professional but friendly",
    "format": "concise"
  },
  "messageExamples": [
    {
      "user": "What's the status of order #123?",
      "agent": "Order #123 is in transit. Expected delivery: tomorrow."
    }
  ],
  "tools": [
    {
      "url": "http://my-api.default.svc.cluster.local",
      "endpoints": [
        { "method": "GET", "path": "/orders", "description": "List orders by status" }
      ]
    }
  ],
  "discord": {
    "channels": ["#support"],
    "threadMode": "per-user"
  },
  "memory": {
    "conversationRetention": "30d",
    "patternRetention": "indefinite",
    "historyRetention": "indefinite"
  },
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  },
  "llm": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "temperature": 0.3,
    "maxTokens": 4096
  },
  "cron": {
    "prompt": "Check all open PRs and report any that need attention."
  }
}
```
