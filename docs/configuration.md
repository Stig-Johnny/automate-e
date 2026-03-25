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
| `discord` | object | Yes | Discord connection settings |
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

## `discord`

Discord connection and routing settings.

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
    "temperature": 0.3
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | string | `"anthropic"` | LLM provider (currently only `"anthropic"`) |
| `model` | string | `"claude-haiku-4-5-20251001"` | Model identifier |
| `temperature` | number | `0.3` | Response randomness (0.0 = deterministic, 1.0 = creative) |

## Environment Variables

These are set on the container, not in `character.json`.

| Variable | Required | Description |
|----------|----------|-------------|
| `CHARACTER_FILE` | Yes | Path to `character.json` (e.g., `/config/character.json`) |
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `DATABASE_URL` | No | Postgres connection string. Omit for in-memory mode. |
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
  "llm": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "temperature": 0.3
  }
}
```
