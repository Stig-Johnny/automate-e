---
title: Architecture — Automate-E
---

# Architecture

## Overview

```
Discord ──websocket──> Gateway (StatefulSet, 1 shard/pod)
                            │
                       BullMQ (Redis)
                            │
                      ┌─────┼─────┐
                      ▼     ▼     ▼
                 Worker  Worker  Worker   ◀── KEDA auto-scales
                      │     │     │
                      ▼     ▼     ▼
                 Postgres (memory)    Your APIs (tools)
```

## Components

### Gateway (StatefulSet)
- 1 pod per Discord shard (1 shard for <1000 guilds)
- Discord WebSocket → BullMQ queue. Replies from queue → Discord.
- No LLM, no business logic. ~32MB RAM.
- **Has:** Discord bot token, Redis credentials
- **Does NOT have:** LLM keys, API secrets, DB credentials

### Workers (Deployment + HPA)
- 1-N replicas, auto-scaled by KEDA based on queue depth
- Picks jobs from BullMQ → loads character + memory → calls LLM with tools → writes reply
- Fully stateless — can restart, move, scale
- **Has:** LLM API key, Postgres credentials, Redis credentials
- **Does NOT have:** Discord bot token, backend API secrets

### Redis
- BullMQ job/reply queues
- Hot memory (active session context)
- KEDA scaler source

### Postgres + pgvector
- Conversations, memory, facts, patterns, processing history, character configs

### External APIs (Tools)
- HTTP endpoints defined in character config
- Workers call via standard HTTP
- Backend authenticates with its own k8s secrets

## Character File

```json
{
  "name": "Book-E",
  "bio": "AI accounting assistant for Invotek AS",
  "personality": "Precise, helpful, speaks Norwegian.",
  "lore": ["Folio for banking", "Fiken for accounting", "25% MVA standard"],
  "style": { "language": "Norwegian", "tone": "professional but friendly" },
  "messageExamples": [
    { "user": "Forward: Adobe invoice 199kr",
      "agent": "Adobe 199 kr → konto 6540 (programvare, 25% MVA). Lagt til på Folio." }
  ],
  "tools": [{
    "url": "http://accountant-api:8080",
    "endpoints": [
      { "method": "POST", "path": "/receipt/attach" },
      { "method": "POST", "path": "/invoice/register" },
      { "method": "GET", "path": "/folio/balance" }
    ]
  }],
  "discord": { "channels": ["#invoices"], "threadMode": "per-document" },
  "memory": { "conversationRetention": "30d", "patternRetention": "indefinite" },
  "llm": { "primary": "gemini-2.5-flash", "fallback": "claude-haiku" }
}
```

## Memory (3-tier, inspired by Letta/MemGPT)

| Tier | Store | Latency | Content | Retention |
|------|-------|---------|---------|-----------|
| **Core** | Redis | <1ms | Active session, working memory | Session |
| **Recall** | Postgres + pgvector | ~5ms | Conversation history, embeddings | 30 days |
| **Archival** | Postgres | ~10ms | Patterns, facts, processing history | Indefinite |

**Observational Memory** (from Mastra): Raw messages compressed into observations ("User prefers account 6540 for software"). Injected into context instead of replaying full history. ~90% token reduction.

**Fact Extraction** (from Mem0): Atomic facts after each conversation: `{merchant: "Adobe", account: 6540, vat: 25}`. Scoped per user, agent, company.

## Scaling

| Queue depth | Workers |
|-------------|---------|
| 0 | 1 (minimum) |
| > 5 | 2 |
| > 20 | 3 |
| > 50 | 5 (maximum) |

KEDA ScaledObject watches BullMQ queue depth in Redis.

## Secret Isolation

| Secret | Gateway | Worker | Backend API |
|--------|---------|--------|-------------|
| Discord bot token | Yes | No | No |
| LLM API key | No | Yes | No |
| Postgres creds | No | Yes | Yes |
| Redis creds | Yes | Yes | No |
| Folio/Fiken keys | No | No | Yes |

## Phases

**Phase 1 (now):** Single Deployment, 1 replica. discord.js + Claude SDK + Postgres.
**Phase 2 (later):** Gateway + Worker + Redis + BullMQ + KEDA. Same character file, transparent upgrade.
