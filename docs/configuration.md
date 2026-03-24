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
| `discord` | object | Yes | Discord connection settings |
| `memory` | object | No | Memory retention policies |
| `llm` | object | Yes | LLM provider and model settings |

## `personality`

The core system prompt. This is the most important field -- it defines who the agent is and how it behaves.

```json
{
  "personality": "You are Book-E, an AI accounting assistant for Invotek AS.\nYou process receipts, register invoices, and answer accounting questions.\nYou speak Norwegian unless the user writes in English."
}
```

!!! tip
    Use `\n` for line breaks. Keep it under 2000 characters. Put detailed knowledge in `lore` instead.

## `lore`

An array of facts the agent should know. Each entry is appended to the system prompt as context.

```json
{
  "lore": [
    "Folio is the business banking system",
    "25% MVA is standard, 15% for food/restaurants",
    "All write actions go through event sourcing: PROPOSED -> APPROVED -> EXECUTED"
  ]
}
```

## `style`

Controls the agent's output format.

```json
{
  "style": {
    "language": "Norwegian",
    "tone": "professional but friendly",
    "format": "concise, use currency formatting for amounts"
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
      "user": "Forward: Adobe invoice 199kr",
      "agent": "Foreslår: Adobe 199 kr -> konto 6540 (programvare, 25% MVA). Auto-godkjent."
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
      "url": "http://eventstore-api.ai-accountant.svc.cluster.local",
      "endpoints": [
        {
          "method": "POST",
          "path": "/propose/receipt",
          "description": "Propose receipt attachment"
        },
        {
          "method": "GET",
          "path": "/events",
          "description": "List events by status or correlationId"
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

## `discord`

Discord connection and routing settings.

```json
{
  "discord": {
    "channels": ["#invoices"],
    "threadMode": "per-document",
    "allowBots": ["1477267530946187305"]
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
  "name": "Book-E",
  "bio": "AI accounting assistant for Invotek AS",
  "personality": "You are Book-E, an AI accounting assistant...",
  "lore": [
    "Folio is the business banking system",
    "Fiken is the accounting system"
  ],
  "style": {
    "language": "Norwegian",
    "tone": "professional but friendly",
    "format": "concise, use currency formatting for amounts"
  },
  "messageExamples": [
    {
      "user": "Forward: Adobe invoice 199kr",
      "agent": "Foreslår: Adobe 199 kr -> konto 6540 (programvare, 25% MVA)."
    }
  ],
  "tools": [
    {
      "url": "http://eventstore-api.ai-accountant.svc.cluster.local",
      "endpoints": [
        { "method": "POST", "path": "/propose/receipt", "description": "Propose receipt attachment" }
      ]
    }
  ],
  "discord": {
    "channels": ["#invoices"],
    "threadMode": "per-document"
  },
  "memory": {
    "conversationRetention": "30d",
    "patternRetention": "indefinite",
    "historyRetention": "5y"
  },
  "llm": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "temperature": 0.3
  }
}
```
