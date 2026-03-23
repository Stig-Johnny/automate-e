# Automate-E

> *The last employee you'll ever hire.*

Kubernetes-native AI agent runtime for Discord. Define an agent in YAML — personality, tools, memory. Deploy with Helm. It scales.

## What

Automate-E runs AI agents on Kubernetes that talk to users on Discord. Agents have:

- **Persistent personality** — character files define who the agent is
- **Long-term memory** — conversations, facts, and patterns in Postgres
- **Tool use** — agents call your HTTP APIs via LLM function calling
- **Horizontal scaling** — gateway receives events, workers process them, KEDA auto-scales
- **Pod resilience** — all state in Postgres + Redis, pods restart without losing anything

## Architecture

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
                 Postgres (memory)
                 Your APIs (tools)
```

## Quick Start

```yaml
# book-e.yaml — an AI accountant
name: Book-E
personality: |
  Norwegian accounting assistant. Precise with numbers.
  Processes receipts, registers invoices, answers questions.
discord:
  channels: ["#invoices"]
tools:
  - url: http://accountant-api:8080
    endpoints:
      - POST /receipt/attach
      - POST /invoice/register
      - GET /folio/balance
llm:
  primary: gemini-2.5-flash
  fallback: claude-haiku
```

```bash
helm install book-e automate-e/agent -f book-e.yaml
```

## Status

**Phase 1** (in progress): Simple single-replica bot for [AI Accountant](https://github.com/Stig-Johnny/ai-accountant).

**Phase 2** (planned): Gateway + worker split, BullMQ, KEDA auto-scaling, Helm chart.

## Docs

- [Architecture](docs/architecture.md) — system design, memory model, scaling
- [Research](docs/research.md) — competitive analysis of 35+ products

## License

TBD — will be open source.
