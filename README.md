# OpenClaw

Kubernetes-native AI agent runtime for Discord.

## What

OpenClaw runs AI agents on Kubernetes that talk to users on Discord. Agents have persistent personality, long-term memory, and call tools via HTTP APIs. Agents scale horizontally — pods can restart, move, and auto-scale without losing state.

## Why

Existing agent frameworks (ElizaOS, Mastra, LangGraph) are single-process runtimes. They work on a laptop but break on Kubernetes where pods are ephemeral. OpenClaw is built for k8s from day one.

## Architecture

```
Discord ──webhook──> Gateway Pod (1 replica, lightweight)
                          │
                     Queue (Redis/Postgres)
                          │
                    ┌─────┼─────┐
                    ▼     ▼     ▼
               Worker   Worker  Worker   ◀── HPA auto-scales
                    │     │     │
                    ▼     ▼     ▼
               Postgres (memory, state)
               External APIs (tools)
```

- **Gateway**: Receives Discord events, queues them. No LLM calls. ~32MB RAM.
- **Workers**: Stateless. Pick up events, run LLM with tools, write reply to queue. Scale with HPA.
- **Memory**: All state in Postgres. Conversations, user facts, learned patterns. Survives pod restarts.
- **Tools**: HTTP endpoints defined as schemas. Agent decides which to call via function calling.

## Key Principles

1. **Pods are ephemeral** — all state in Postgres/Redis, never in-process
2. **Secret isolation** — agent has no backend secrets, only Discord token + API URL + LLM key
3. **Character as config** — personality defined in YAML, deployed via GitOps
4. **Tools as HTTP** — agents call typed HTTP endpoints, not raw code
5. **Horizontal scaling** — add workers, not bigger pods

## Status

**Phase 1 (now):** Simple single-replica bot for [AI Accountant](https://github.com/Stig-Johnny/ai-accountant). discord.js + Claude SDK + Postgres.

**Phase 2 (planned):** Gateway + worker split, multi-replica, Helm chart, character YAML, HPA.

## License

TBD — will be open source.
