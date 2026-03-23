---
title: Competitive Research — Automate-E
---

# Competitive Research

Research across 35+ products in 6 categories. **No single product combines all six capabilities we need**: character personality + Discord-native + Kubernetes-native + multi-replica scaling + persistent memory + function calling.

## The Gap

| Capability | ElizaOS | Mastra | LangGraph | CrewAI | kagent | **Automate-E** |
|---|---|---|---|---|---|---|
| Character/Personality | Yes | No | No | Partial | No | **Yes** |
| Discord Native | Plugin | No | No | No | No | **Yes** |
| K8s Native | No | No | No | No | Yes | **Yes** |
| Multi-Replica Scaling | No | No | Commercial | No | Yes | **Yes** |
| Persistent Memory | Basic | Good | Checkpoint | 4-layer | No | **Yes** |
| Function Calling | Actions | Tools | Tools | Tools | MCP | **Yes** |

## Key Findings by Category

### Character Frameworks
- **ElizaOS** (17.8k stars, MIT): De facto standard for character files. Plugin architecture. Native Discord. But single-process, no k8s.
- **Letta/MemGPT** (15k stars, Apache-2.0): Best memory model — 3-tier (core/recall/archival) inspired by OS architecture. Agents edit own memory.
- **SillyTavern** (43k stars, AGPL): World Info for lore injection. Universal LLM backend switching.

### Agent Orchestration
- **Mastra** (22k stars, Apache-2.0): Best observational memory — compressed reflections reduce tokens ~90%.
- **LangGraph** (44.6k stars, MIT): Checkpoint-per-step. Used by LinkedIn, Uber, Klarna.
- **Flowise** (50.9k stars, Apache-2.0): **Dual-mode deployment** — simple (SQLite) for dev, BullMQ+Redis for production scaling. Directly relevant pattern.
- **Dify** (129.8k stars): Low barrier to entry drives adoption. Docker Compose first.

### Discord on Kubernetes
- **Kubecord**: **The reference architecture.** Gateway → NATS → Workers → Redis. Shards as separate pods. Exactly the pattern we need.
- **Marver**: K8s StatefulSet autoscaler using Discord's recommended shard count.
- **discord-hybrid-sharding**: 40-60% resource reduction vs standard sharding.

### K8s-Native AI
- **kagent** (817 stars, Apache-2.0, CNCF): Agent CRDs (Agent, ModelConfig, RemoteMCPServer). First k8s-native agent framework.
- **Agent Sandbox** (kubernetes-sigs): Warm pools for <1s cold start. Suspension/resumption. Official k8s SIG project.
- **KServe/Seldon/Ray**: ML serving patterns — CRDs, scale-to-zero, vertical-before-horizontal scaling.

### Memory Systems
- **Mem0** (50.6k stars): Atomic fact extraction. 26% accuracy over OpenAI Memory. 91% faster. 90% fewer tokens.
- **Zep/Graphiti**: Temporal knowledge graph — facts have periods of validity.
- **Motorhead** (Rust): Dead simple — 3 endpoints. Incremental summarization.

### Message Queues
- **BullMQ**: Proven by Flowise for horizontal scaling. KEDA integration. TypeScript native.
- **NATS JetStream**: Used by Kubecord. Lightweight. Built-in service discovery.
- **Postgres LISTEN/NOTIFY**: **Does NOT scale** — global mutex bottleneck.
- **Redis Streams**: Middle ground. Consumer groups + replay. KEDA support.

## Technology Decisions

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | ElizaOS, Mastra, Flowise all TS. Largest Discord ecosystem. |
| Discord Gateway | StatefulSet, 1 shard/pod | Kubecord pattern. Stable identity. |
| Event Bus | BullMQ (Redis) | Proven by Flowise. KEDA integration. TypeScript native. |
| Memory — Hot | Redis | Sub-ms working memory. |
| Memory — Warm | Postgres + pgvector | Searchable history with embeddings. |
| Memory — Cold | Postgres archival | Long-term, 5yr retention. |
| Character Format | ElizaOS-compatible JSON | De facto standard. |
| Agent CRD | Inspired by kagent + agent-sandbox | K8s-native declarative. |
| Autoscaling | KEDA + HPA | Event-driven based on queue depth. |
| LLM | Vercel AI SDK | Multi-provider (Claude, Gemini, OpenAI). |

## Sources

Key references (full list in research agent output):
- [Kubecord](https://github.com/kubecord/Kubecord) — k8s Discord architecture
- [ElizaOS](https://github.com/elizaOS/eliza) — character file standard
- [Letta](https://github.com/letta-ai/letta) — memory hierarchy
- [Mem0](https://github.com/mem0ai/mem0) — atomic memory extraction
- [kagent](https://github.com/kagent-dev/kagent) — k8s agent CRDs
- [Agent Sandbox](https://github.com/kubernetes-sigs/agent-sandbox) — k8s SIG
- [Flowise](https://github.com/FlowiseAI/Flowise) — BullMQ scaling
- [Mastra](https://github.com/mastra-ai/mastra) — observational memory
- [KEDA](https://keda.sh/) — event-driven autoscaling
