---
title: Automate-E Runtime
---

# Automate-E Runtime

Automate-E is a Kubernetes-native AI agent runtime for Discord. It turns a `character.json` config file into a running Discord bot backed by Claude, with persistent memory, tool calling, and cost tracking.

- **Repository:** [Stig-Johnny/automate-e](https://github.com/Stig-Johnny/automate-e) (public, MIT license)
- **Documentation:** [stig-johnny.github.io/automate-e](https://stig-johnny.github.io/automate-e/)
- **Deployment:** Helm chart in `charts/automate-e/`, deployed via ArgoCD

## Key Features

| Feature | Description |
|---------|-------------|
| **Character-driven** | Define personality, tools, and behavior in a single JSON file |
| **Claude-powered** | Agent loop uses Anthropic Claude API with tool use |
| **Postgres memory** | Conversations, user facts, and merchant patterns persist across restarts |
| **In-memory fallback** | Works without Postgres for local development |
| **Tool calling** | Agents call HTTP APIs defined in `character.json` |
| **Cost tracking** | Per-model token usage and cost calculation |
| **Live dashboard** | Real-time WebSocket dashboard for monitoring agent activity |
| **Helm chart** | Deploy single-process or gateway+worker mode via Helm |
| **Split mode** | Gateway + Redis Streams + workers for horizontal scaling |

## How It Works

```mermaid
sequenceDiagram
    participant U as Discord User
    participant G as Discord Gateway
    participant A as Agent Loop
    participant C as Claude API
    participant T as Tool APIs
    participant M as Memory (Postgres)

    U->>G: Message in #example-e
    G->>A: messageCreate event
    A->>M: Load conversation history + user facts
    A->>C: System prompt + history + tools
    C->>A: tool_use: get_quotes_random
    A->>T: GET /quotes/random
    T->>A: {text: "Talk is cheap...", author: "Linus Torvalds"}
    A->>C: Tool result
    C->>A: Text response
    A->>M: Save messages
    A->>G: Reply in thread
    G->>U: "Here's a quote from Linus Torvalds: ..."
```

## Get Started

1. [Quick Start](quickstart.md) -- run an agent locally in 5 minutes (test mode, no Discord needed)
2. [Discord Bot Setup](discord-setup.md) -- create a bot and connect to Discord
3. [Configuration](configuration.md) -- full `character.json` reference

## Learn More

- [Architecture](architecture.md) -- how the runtime works internally
- [Deployment](deployment.md) -- deploy to Kubernetes with Helm
- [Dashboard](dashboard.md) -- real-time monitoring UI
- [Memory](memory.md) -- persistent conversations and facts
