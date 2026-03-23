# Automate-E

> *The last employee you'll ever hire.*

OpenClaw, evolved for Kubernetes. Persistent state, horizontal scaling, Helm charts.

## What

Automate-E extends [OpenClaw](https://github.com/openclaw/openclaw) — the open-source agent runtime powering Pi-E, Volt-E, Review-E, and iBuild-E — with Kubernetes-native persistence and scaling. Everything OpenClaw does, Automate-E does. Plus:

- **State survives pod restarts** — sessions, memory, and facts persisted in Postgres + Redis
- **Horizontal scaling** — gateway receives Discord events, workers process them, KEDA auto-scales
- **Deploy with Helm** — `helm install book-e automate-e/agent -f agent.yaml`
- **Same config format** — `openclaw.json` + `SOUL.md` work unchanged

## Why Not Just Run OpenClaw on k8s?

You can. But:

| Problem | What Happens |
|---|---|
| Pod restarts | All sessions, memory, and context lost (in-memory only) |
| Node maintenance | Agent goes down, no failover |
| Scaling | Single process, can't handle concurrent load |
| Gateway bind | `"lan"` mode breaks in Docker/k8s networking |

Automate-E solves these by adding a persistence layer and a queue-based architecture on top of OpenClaw.

## Architecture

### Phase 1 (Now) — OpenClaw + Postgres

```
Discord ──> OpenClaw pod (1 replica)
                │
           Postgres (sessions, memory, facts)
           External APIs (tools)
```

Single pod, same as today's OpenClaw, but with Postgres-backed memory instead of in-memory. Pod restarts don't lose state.

### Phase 2 (Planned) — Gateway + Workers

```
Discord ──> Gateway (StatefulSet, 1 shard/pod)
                │
           BullMQ (Redis)
                │
          ┌─────┼─────┐
          ▼     ▼     ▼
     Worker  Worker  Worker   ◀── KEDA auto-scales
          │     │     │
          ▼     ▼     ▼
     Postgres + Redis
     External APIs
```

## Quick Start

```bash
# Deploy Book-E (AI Accountant) on k3s
helm install book-e automate-e/agent \
  --set-file soul=SOUL.md \
  --set-file config=openclaw.json \
  --set discord.tokenSecret=book-e-secrets \
  --set llm.apiKeySecret=book-e-secrets
```

## First Agent: Book-E

Book-E is an AI accounting assistant for Invotek AS. It processes receipts, registers invoices, and answers accounting questions on Discord. Defined entirely in config — no code.

- **SOUL.md** — Norwegian accounting personality
- **openclaw.json** — Discord #invoices channel, Claude Haiku, tool endpoints
- **Deploys on** — `ghcr.io/stig-johnny/automate-e` with config mounted as ConfigMap

See [Stig-Johnny/ai-accountant](https://github.com/Stig-Johnny/ai-accountant) for the agent config.

## Docs

- [Architecture](docs/architecture.md) — how Automate-E extends OpenClaw for k8s
- [Research](docs/research.md) — competitive analysis, what we learn from 35+ products

## Status

- [x] Research and architecture design
- [ ] Phase 1: OpenClaw + Postgres persistence adapter
- [ ] Phase 1: Helm chart
- [ ] Phase 1: Book-E deployed on k3s
- [ ] Phase 2: Gateway + Worker split
- [ ] Phase 2: BullMQ + KEDA auto-scaling
- [ ] Phase 3: Agent CRD, multi-agent platform

## License

TBD — will be open source.
