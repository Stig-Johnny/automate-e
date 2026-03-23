---
title: Architecture — Automate-E
---

# Architecture

## Core Idea

Automate-E is **OpenClaw, evolved for Kubernetes.** Not a new agent framework — an extension that makes OpenClaw's battle-tested agent model work in k8s where pods are ephemeral, workloads scale horizontally, and state must survive restarts.

## What OpenClaw Already Does Well

OpenClaw is the production agent runtime powering Pi-E, Volt-E, Review-E, and iBuild-E. It handles:

| Capability | How OpenClaw Does It |
|---|---|
| **Personality** | SOUL.md — identity, guardrails, communication style |
| **Discord** | Native WebSocket gateway, per-channel config, mention handling, thread sessions |
| **Tools** | MCP tool profiles (fs, shell, cron, web, memory, browser) with deny-lists |
| **Memory** | Built-in `memory_search()` / `memory_set()` via MCP |
| **Model failover** | Primary + fallbacks, automatic retry on 529 |
| **Security** | 3-layer: Tailscale ACL + Docker iptables + tool deny-lists |
| **Session management** | Per-thread sessions with idle timeout |
| **Configuration** | `openclaw.json` — model, tools, channels, sandbox, gateway |

**We don't rebuild any of this.** We inherit it.

## What OpenClaw Lacks for Kubernetes

| Gap | Problem | Automate-E Solution |
|---|---|---|
| **In-memory sessions** | Pod restart = lost state | Postgres + Redis persistence layer |
| **Single-process** | Can't scale, can't survive eviction | Gateway + Worker split |
| **No HPA** | Fixed resource allocation | KEDA auto-scaling on queue depth |
| **Docker-only deploy** | Manual `docker run` on bare metal | Helm chart, ArgoCD, k8s-native |
| **No shared state** | Each agent instance is isolated | Shared Postgres for multi-replica workers |
| **Gateway bind issues** | `lan` mode breaks in Docker, cron fails | k8s Service networking, no bind hacks |

## Architecture: OpenClaw + k8s Persistence Layer

```
                    ┌─────────────────────────────────┐
                    │         Discord Gateway           │
                    │                                   │
                    │  OpenClaw (mostly unchanged)       │
                    │  - Discord WebSocket connection    │
                    │  - Session routing                 │
                    │  - SOUL.md personality             │
                    │  - openclaw.json config            │
                    │                                   │
                    │  CHANGED: writes events to queue   │
                    │  instead of processing in-process  │
                    └──────────────┬────────────────────┘
                                   │
                              BullMQ (Redis)
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              ┌──────────┐  ┌──────────┐  ┌──────────┐
              │ Worker 1 │  │ Worker 2 │  │ Worker 3 │  ← KEDA
              │          │  │          │  │          │
              │ Claude   │  │ Claude   │  │ Claude   │
              │ MCP tools│  │ MCP tools│  │ MCP tools│
              │ Memory   │  │ Memory   │  │ Memory   │
              └────┬─────┘  └────┬─────┘  └────┬─────┘
                   │             │             │
                   ▼             ▼             ▼
              ┌──────────────────────────────────────┐
              │  Persistence Layer (NEW)               │
              │                                        │
              │  Redis: hot memory, active sessions     │
              │  Postgres + pgvector: conversations,    │
              │    facts, patterns, archival             │
              └──────────────────────────────────────┘
```

## What Changes in OpenClaw

Automate-E does NOT fork or rewrite OpenClaw. It wraps it with a persistence adapter and a queue layer:

### 1. Persistence Adapter

Replace OpenClaw's in-memory `memory_search`/`memory_set` with a Postgres-backed implementation:

```
OpenClaw memory_set("user_prefers_6540", "...")
  ↓
Automate-E adapter
  ↓
INSERT INTO facts (agent, user_id, key, value) VALUES (...)
```

Same MCP tool interface. OpenClaw doesn't know the difference. Sessions, conversations, and facts survive pod restarts.

### 2. Queue Layer (Phase 2)

Split the Discord gateway from the agent processing:

- **Gateway pod** (StatefulSet, 1 replica): OpenClaw's Discord WebSocket, but instead of processing messages in-process, writes them to BullMQ
- **Worker pods** (Deployment, 1-N replicas): OpenClaw agent loop + MCP tools, picks up from queue, writes reply back

Phase 1 runs as a single pod (like today's OpenClaw). Phase 2 adds the split.

### 3. Helm Chart

Package everything as a Helm chart:

```bash
helm install book-e automate-e/agent \
  --set character.file=character.json \
  --set soul.file=SOUL.md \
  --set discord.token=<from-secret> \
  --set llm.apiKey=<from-secret>
```

The chart creates:
- ConfigMap from SOUL.md + character config
- Deployment (Phase 1) or StatefulSet + Deployment (Phase 2)
- SealedSecret references
- Optional: Redis, KEDA ScaledObject

## Agent Configuration

Automate-E agents use the same config files as OpenClaw:

### openclaw.json — Runtime Config
Model, tools, Discord channels, sandbox, gateway. **Unchanged from OpenClaw format.** Any existing openclaw.json works.

### SOUL.md — Personality & Operating Rules
Identity, guardrails, communication style, rate limits. **Unchanged from OpenClaw format.** Book-E's SOUL.md defines its accounting personality.

### character.json — Automate-E Extension (Optional)
Additional config for Automate-E-specific features not in openclaw.json:
- HTTP tool endpoints (typed API calls)
- Memory retention settings
- Observational memory config
- Message examples for few-shot prompting

This is additive — OpenClaw agents that don't use these features don't need this file.

## Memory Architecture

Three tiers, extending OpenClaw's `memory_search`/`memory_set`:

| Tier | Store | OpenClaw Equivalent | What Changes |
|------|-------|---|---|
| **Hot** | Redis | In-memory session state | Moved to Redis (survives restart) |
| **Warm** | Postgres + pgvector | `memory_search()` / `memory_set()` | Backed by Postgres instead of in-memory |
| **Cold** | Postgres archival | Not available in OpenClaw | NEW: long-term patterns, processing history, 5yr retention |

### Observational Memory (NEW)

After conversations, extract compressed observations:
- "User prefers account 6540 for software purchases"
- "Adobe invoices are always 199 kr/month"

Injected into context instead of replaying full history. ~90% token reduction for long-running agents.

## Security Model

Inherits OpenClaw's 3-layer security and adds k8s-native isolation:

| Layer | OpenClaw | Automate-E |
|---|---|---|
| **Network** | Tailscale ACL + Docker iptables | k8s NetworkPolicy |
| **Tools** | MCP tool profiles + deny-lists | Same (unchanged) |
| **Secrets** | Environment variables in Docker | k8s SealedSecrets, RBAC |
| **Agent isolation** | Separate Docker containers | Separate pods, namespaces |

**Secret isolation principle (from AI Accountant docs):** The agent pod has Discord + LLM keys only. Backend API keys (Folio, Fiken, Postgres) live in the API pod. Compromising the agent doesn't expose financial data.

## Scaling Model

| Phase | Replicas | How |
|---|---|---|
| **Phase 1** | 1 pod | Single OpenClaw instance with Postgres persistence |
| **Phase 2** | 1 gateway + N workers | Gateway StatefulSet + Worker Deployment + BullMQ + KEDA |

KEDA ScaledObject watches BullMQ queue depth in Redis:

| Queue depth | Workers |
|---|---|
| 0 | 1 (minimum) |
| > 5 | 2 |
| > 20 | 3 |
| > 50 | 5 (maximum) |

## Phases

### Phase 1: OpenClaw + Postgres (Now)

- Run OpenClaw as-is on k8s (single pod)
- Add Postgres persistence adapter for memory
- SOUL.md + openclaw.json mounted as ConfigMaps
- Helm chart for deployment
- Book-E as first agent

### Phase 2: Gateway + Worker Split

- Extract Discord gateway into StatefulSet
- BullMQ queue between gateway and workers
- Worker Deployment with HPA/KEDA
- Redis for hot state + queue

### Phase 3: Multi-Agent Platform

- Multiple agents on the same cluster
- Shared Postgres, separate Redis namespaces
- Agent CRD (inspired by kagent)
- `automate-e agent create book-e -f agent.yaml`

## Relationship to OpenClaw

```
OpenClaw (open source)
  │
  ├── Used directly by: Pi-E, Volt-E, Review-E, iBuild-E
  │   (Docker on bare metal / VPS)
  │
  └── Extended by: Automate-E
      │
      ├── Adds: Postgres persistence, k8s deployment, Helm chart
      ├── Adds: Gateway+worker split, HPA scaling
      ├── Adds: Observational memory, cold archival
      │
      └── First agent: Book-E (AI Accountant)
          (k8s on Dell k3s cluster)
```

Automate-E is a **superset** of OpenClaw. Every OpenClaw feature works. Automate-E adds k8s-native persistence and scaling on top. When these features mature, they can be contributed back upstream.
