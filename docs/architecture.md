---
title: Architecture
---

# Architecture

How the Automate-E runtime turns a `character.json` into a running Discord agent.

## Component Overview

```mermaid
graph TB
    subgraph "Automate-E Runtime"
        CL[Character Loader<br/>character.js]
        DG[Discord Gateway<br/>discord.js]
        AL[Agent Loop<br/>agent.js]
        TD[Tool Dispatcher<br/>agent.js]
        MS[Memory Store<br/>memory.js]
        UT[Usage Tracker<br/>usage.js]
        DB[Dashboard<br/>dashboard/]
    end

    CF[character.json<br/>ConfigMap] --> CL
    DC[Discord] <--> DG
    DG --> AL
    AL --> TD
    AL <--> MS
    AL --> UT
    TD --> API[Tool APIs]
    AL <--> Claude[Claude API]
    DB <--> WS[WebSocket Clients]
    UT --> DB
```

## Startup Sequence

```mermaid
sequenceDiagram
    participant R as Runtime
    participant CL as Character Loader
    participant MS as Memory Store
    participant DG as Discord Gateway
    participant DB as Dashboard

    R->>CL: Load CHARACTER_FILE
    CL->>CL: Validate required fields
    CL->>CL: Apply defaults
    R->>MS: Connect to Postgres (or init in-memory)
    R->>DG: Login with DISCORD_BOT_TOKEN
    DG->>DG: Register messageCreate handler
    R->>DB: Start HTTP + WebSocket server
    Note over R: Agent is ready
```

## Message Processing

When a Discord message arrives, the runtime processes it through these stages:

```mermaid
flowchart TD
    MSG[Discord messageCreate] --> FILTER{Channel match?}
    FILTER -->|No| DROP[Ignore]
    FILTER -->|Yes| BOT{From allowed bot<br/>or human?}
    BOT -->|No| DROP
    BOT -->|Yes| LOAD[Load conversation<br/>history from memory]
    LOAD --> BUILD[Build system prompt:<br/>personality + lore +<br/>user facts + style]
    BUILD --> CALL[Call Claude API<br/>with tools]
    CALL --> TOOL{Tool use<br/>response?}
    TOOL -->|Yes| EXEC[Execute HTTP call<br/>to tool API]
    EXEC --> RESULT[Return result<br/>to Claude]
    RESULT --> CALL
    TOOL -->|No| TEXT[Extract text response]
    TEXT --> SAVE[Save messages<br/>to memory]
    SAVE --> REPLY[Post reply<br/>in Discord thread]
```

## Key Design Decisions

### Tool Calling via HTTP

Tools are HTTP endpoints, not code plugins. This means:

- Agents can call any REST API without runtime changes
- Tool definitions are pure configuration (no code deployment)
- APIs can be written in any language
- Tools are independently scalable Kubernetes services

### Character as Configuration

The entire agent personality and behavior is defined in `character.json`:

- No agent-specific code in the runtime
- Multiple agents share the same runtime image
- Character changes deploy via ConfigMap update (no image rebuild)
- Version control and review for personality changes

### Memory Layers

The memory system has three layers:

| Layer | Scope | Retention | Purpose |
|-------|-------|-----------|---------|
| Conversations | Per thread | Configurable (default 30d) | Context for ongoing conversations |
| Facts | Per user | Indefinite | Learned preferences and patterns |
| Patterns | Per entity (e.g., merchant) | Indefinite | Auto-approval confidence scores |

### Agent Loop Constraints

- Maximum 5 tool calls per message (prevents runaway loops)
- Each tool call is an independent HTTP request
- The agent loop is synchronous per message (no parallel tool calls)
- Failed tool calls return error text to Claude (does not crash the loop)

## File Structure

```
automate-e/
  src/
    index.js          # Entry point, startup orchestration
    character.js      # Loads and validates character.json
    agent.js          # Agent loop, tool dispatch, prompt building
    memory.js         # Postgres + in-memory storage
    usage.js          # Token counting and cost calculation
    dashboard/
      server.js       # HTTP server + WebSocket
      index.html      # Dashboard UI
  Dockerfile
  package.json
```
