---
title: Competitive Research — Automate-E
---

# Competitive Research

## Starting Point: OpenClaw

Automate-E is not built from scratch. It extends [OpenClaw](https://github.com/openclaw/openclaw), the open-source agent runtime already powering Pi-E, Volt-E, Review-E, and iBuild-E in production.

### What OpenClaw Has

| Feature | Implementation |
|---|---|
| **Personality** | SOUL.md — identity, guardrails, style, rate limits |
| **Discord** | Native WebSocket gateway, per-channel config, mention handling, sessions |
| **Telegram** | Native, with pairing and DM policies |
| **Tools** | MCP profiles: fs, shell, cron, memory, web, browser. Deny-list security model |
| **Memory** | `memory_search()` / `memory_set()` MCP tools (in-memory) |
| **Model failover** | Primary + fallbacks, auto-retry on 529 |
| **Security** | 3-layer: network (Tailscale/iptables) + tools (deny-list) + config (sandbox) |
| **Sessions** | Per-thread, idle timeout, history limit |
| **Config** | `openclaw.json` — one file for everything |
| **Auth** | OAuth (Claude Max) or API key |
| **Deployment** | Docker container per agent on bare metal/VPS |

### What OpenClaw Lacks

| Gap | Impact |
|---|---|
| In-memory state only | Pod restart = all sessions, memory, and context lost |
| Single-process architecture | Cannot scale horizontally, single point of failure |
| No k8s support | Manual Docker deploy, no Helm, no ArgoCD, no HPA |
| No shared state | Each agent instance is fully isolated |
| Docker networking issues | `gateway.bind: "lan"` breaks cron in Docker |
| No long-term archival | No 5-year retention, no observational memory |

## Competitive Landscape

Research across 35+ products. Key finding: **no product combines OpenClaw's agent model with Kubernetes-native scaling and persistent state.**

### OpenClaw vs Everything Else

| | OpenClaw | ElizaOS | Mastra | LangGraph | kagent | **Automate-E** |
|---|---|---|---|---|---|---|
| Battle-tested agents | **Yes** (4 in prod) | Community | No agents in prod | Enterprise | DevOps only | **Yes** (inherits) |
| Personality (SOUL.md) | **Yes** | Character JSON | Prompt only | Prompt only | No | **Yes** (inherits) |
| Discord native | **Yes** | Plugin | No | No | No | **Yes** (inherits) |
| MCP tools | **Yes** | Plugin actions | Zod tools | LangChain tools | MCP | **Yes** (inherits) |
| Model failover | **Yes** | Config | Vercel AI SDK | LangChain | Config | **Yes** (inherits) |
| Security layers | **3-layer** | Basic | None | None | RBAC | **3-layer** (inherits + k8s) |
| Persistent memory | In-memory | Postgres | Postgres | Postgres | None | **Postgres** (new) |
| K8s native | No | No | No | No | **Yes** | **Yes** (new) |
| Multi-replica | No | No | No | Commercial | Yes | **Yes** (new) |
| Helm chart | No | No | No | No | Yes | **Yes** (new) |
| Pod restart resilience | No | No | Yes | Yes | Yes | **Yes** (new) |

### Key Insight

Every other framework would require us to rebuild what OpenClaw already does (Discord, tools, sessions, security). Automate-E avoids that by extending OpenClaw with the pieces it's missing.

## What We Learn From Other Products

### From ElizaOS: Character File Format
ElizaOS character JSON (name, bio, lore, style, message examples) is the community standard for AI character definition. We should support this format alongside SOUL.md for agents that need structured personality beyond free-form markdown.

### From Letta/MemGPT: Memory Hierarchy
Three-tier memory model (Core/Recall/Archival) inspired by OS architecture. Agents edit their own memory using tools. We apply this to OpenClaw's `memory_search`/`memory_set`:
- **Core** = Redis (hot, active session) — replaces OpenClaw's in-memory
- **Recall** = Postgres + pgvector (warm, searchable history)
- **Archival** = Postgres (cold, 5-year retention)

### From Mastra: Observational Memory
Compressed reflections stored separately from raw messages. "User prefers account 6540 for software." Reduces token costs ~90%. We add this as a post-conversation extraction step.

### From Mem0: Atomic Fact Extraction
Extract `{user, fact, confidence}` tuples after conversations. Scoped per user, agent, company. 26% accuracy improvement over stuffing raw context.

### From Kubecord: Gateway + Worker Pattern
The reference architecture for Discord bots on k8s. Gateway (StatefulSet) → NATS/Redis → Workers (Deployment). We adopt this for Phase 2, using BullMQ instead of NATS (TypeScript native, KEDA integration).

### From Flowise: Dual-Mode Deployment
Simple mode (SQLite, single process) for dev, production mode (Postgres + Redis + BullMQ) for scaling. Users start simple, graduate to distributed. We apply this: Phase 1 is single-pod OpenClaw with Postgres, Phase 2 adds the split.

### From kagent: Agent CRD
K8s custom resource definitions for agents. `kubectl apply -f agent.yaml` creates a running agent. We adopt this pattern for Phase 3.

### From Agent Sandbox (k8s-sigs): Warm Pools
Pre-warmed pods for <1s cold start. Suspension/resumption for idle agents. We adopt this for cost efficiency when running many agents.

## Technology Choices

| Component | Choice | Rationale |
|---|---|---|
| **Runtime base** | OpenClaw (Node.js/TypeScript) | Battle-tested, 4 agents in production |
| **Persistence** | Postgres + pgvector | OpenClaw memory_set → Postgres adapter |
| **Hot state** | Redis | Session state + BullMQ queue |
| **Queue** | BullMQ | Proven by Flowise, KEDA integration, TypeScript |
| **Discord** | OpenClaw native | Already works, don't rebuild |
| **Tools** | OpenClaw MCP | Already works, don't rebuild |
| **Personality** | SOUL.md (OpenClaw) + character.json (optional) | Inherit what works, extend where needed |
| **Autoscaling** | KEDA | Event-driven scaling on queue depth |
| **Deployment** | Helm chart | k8s-native, ArgoCD-compatible |
| **Agent definition** | CRD (Phase 3) | Inspired by kagent |

## Sources

- [OpenClaw](https://github.com/openclaw/openclaw) — base runtime
- [Kubecord](https://github.com/kubecord/Kubecord) — k8s Discord gateway+worker pattern
- [ElizaOS](https://github.com/elizaOS/eliza) — character file format
- [Letta/MemGPT](https://github.com/letta-ai/letta) — 3-tier memory hierarchy
- [Mem0](https://github.com/mem0ai/mem0) — atomic fact extraction
- [Mastra](https://github.com/mastra-ai/mastra) — observational memory
- [Flowise](https://github.com/FlowiseAI/Flowise) — BullMQ dual-mode scaling
- [kagent](https://github.com/kagent-dev/kagent) — k8s agent CRDs
- [Agent Sandbox](https://github.com/kubernetes-sigs/agent-sandbox) — k8s-sigs warm pools
- [KEDA](https://keda.sh/) — event-driven autoscaling
