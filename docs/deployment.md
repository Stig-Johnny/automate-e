---
title: Deployment
---

# Deployment

Automate-E supports two deployment modes via its Helm chart (`charts/automate-e/`).

## Deployment Modes

### Single-process mode

One pod runs `index.js`, which handles the Discord gateway, agent loop, and dashboard. Simple to operate, suitable for low traffic.

### Gateway + worker mode (production)

Set `mode: split` and enable Redis. The gateway pod connects to Discord and publishes messages to a Redis Stream. Worker pods consume messages via a consumer group and send replies directly through the Discord REST API. A Redis SETNX lock prevents duplicate processing.

## Helm Chart

The Helm chart is the primary deployment method. It lives in `charts/automate-e/`.

### Single-process values.yaml

```yaml
mode: single

image:
  repository: ghcr.io/stig-johnny/automate-e
  tag: latest

secrets:
  existingSecret: my-agent-secrets

character:
  name: My Agent
  bio: "A helpful assistant"
  # ... full character.json contents

dashboard:
  enabled: true
  port: 3000

resources:
  requests:
    memory: 64Mi
    cpu: 50m
  limits:
    memory: 256Mi
    cpu: 500m
```

### Gateway + worker values.yaml (production)

```yaml
mode: split

image:
  repository: ghcr.io/stig-johnny/automate-e
  tag: latest

secrets:
  existingSecret: my-agent-secrets

redis:
  enabled: true
  deploy: true
  storage: 1Gi
  storageClass: nfs-csi

workers:
  replicas: 2

character:
  name: My Agent
  bio: "A helpful assistant"
  # ... full character.json contents

dashboard:
  enabled: true
  port: 3000

tunnel:
  enabled: true
  tokenSecretName: cloudflared-automate-e-token
  hostname: my-agent.example.com
```

## Namespace

All resources deploy to the `automate-e` namespace:

```bash
kubectl create namespace automate-e
```

## Secrets

Create secrets manually before deploying. The chart references them via `secrets.existingSecret`:

```bash
# Agent secrets (Discord token + Anthropic/OpenAI key + optional DB URL)
kubectl create secret generic my-agent-secrets \
  -n automate-e \
  --from-literal=discord-bot-token=<token> \
  --from-literal=anthropic-api-key=<key> \
  --from-literal=openai-api-key=<key> \
  --from-literal=database-url=<url>

# GHCR pull secret (for private images)
kubectl create secret docker-registry ghcr-pull-secret \
  -n automate-e \
  --docker-server=ghcr.io \
  --docker-username=<user> \
  --docker-password=<pat>

# Cloudflare Tunnel token (if using tunnel)
kubectl create secret generic cloudflared-automate-e-token \
  -n automate-e \
  --from-literal=token=<tunnel-token>
```

Do not use SealedSecrets. Secrets are created manually and referenced by name.

For `llm.provider: codex-cli`, there are two auth patterns:

- Persistent host: run `codex login` on the machine and preserve the Codex auth directory.
- If you set `llm.authMode: device-auth`, the runtime can trigger `codex login --device-auth`, post the browser URL/code through progress updates, and wait for a human to complete login.
- Kubernetes/ephemeral pod: prefer `OPENAI_API_KEY` because interactive ChatGPT login is brittle across pod restarts.

If you must use ChatGPT login in Kubernetes, preserve the Codex home directory and mount it at the real runtime path:

```yaml
codexHomePersistence:
  enabled: true
  size: 1Gi

extraEnv:
  - name: CODEX_HOME
    value: /home/node/.codex
```

This only works reliably if:

- the pod uses a stable runtime home
- the PVC is mounted at the actual Codex home path
- the workload stays single-replica
- Discord/webhook progress messages are enabled so operators can complete device-auth

## Heartbeat Overview

When `heartbeat.url` and `heartbeat.agentId` are configured, Automate-E sends a richer `HEARTBEAT` payload to Conductor-E every interval.

That heartbeat now includes:

- `status`, `currentIssue`, `currentRepo`
- `activeProvider`
- `availableProviders`
- `providers[]` with health for each configured AI service
- `integrations[]` with runtime integration status

The integration snapshot covers the things Conductor-E needs for operator visibility, including:

- Discord connectivity
- Conductor heartbeat target configuration
- MCP server connectivity snapshot
- webhook configuration
- GitHub auth configuration

Conductor-E projects this into `/api/agents`, which becomes the single overview of which agents are online, which AI service each agent is actively using, and which integrations are healthy or degraded.

## ArgoCD

ArgoCD syncs the Helm chart directly from the automate-e repo:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: automate-e
  namespace: argocd
spec:
  project: default
  sources:
    - repoURL: https://github.com/Stig-Johnny/automate-e.git
      targetRevision: HEAD
      path: charts/automate-e
      helm:
        valueFiles:
          - $values/deploy/my-agent/values.yaml
    - repoURL: https://github.com/your-org/your-config-repo.git
      targetRevision: HEAD
      ref: values
  destination:
    server: https://kubernetes.default.svc
    namespace: automate-e
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

Image tags use git SHAs. CI builds push new images to GHCR, and ArgoCD detects chart or value changes on sync.

## Cloudflare Tunnel

The dashboard is exposed via Cloudflare Tunnel (no public LoadBalancer or Ingress). Enable it in values:

```yaml
tunnel:
  enabled: true
  tokenSecretName: cloudflared-automate-e-token
  hostname: my-agent.example.com
```

This deploys a `cloudflared` sidecar that routes traffic from the public hostname to the dashboard service inside the cluster.

## Cron Mode (Scheduled Agents)

Add a CronJob alongside the Discord bot by setting `cron.enabled: true`. The CronJob runs `run-once.js` which executes the prompt from `character.cron.prompt` and posts results to a Discord webhook.

```yaml
mode: single  # Discord bot as usual

cron:
  enabled: true
  schedule: "*/5 * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3

# Extra env vars for MCP servers (e.g., GitHub token)
extraEnv:
  - name: GITHUB_PERSONAL_ACCESS_TOKEN
    valueFrom:
      secretKeyRef:
        name: my-agent-secrets
        key: github-token
```

The CronJob shares the same character, secrets, and database as the Deployment. Add `discord-webhook-url` to your secret:

```bash
kubectl create secret generic my-agent-secrets \
  -n my-namespace \
  --from-literal=discord-bot-token=<token> \
  --from-literal=anthropic-api-key=<key> \
  --from-literal=openai-api-key=<key> \
  --from-literal=discord-webhook-url=<webhook-url> \
  --from-literal=github-token=<pat>
```

You can also run cron-only (no Discord bot) by omitting the `discord-bot-token`.

For Codex device-auth in cron / one-shot mode, that webhook is also where operator alerts go:

- login required
- login already in progress
- cooldown / rate-limit
- login complete
- selected provider failed

## Adding a New Agent

1. Create a new `character.json` for the agent
2. Create a new values file referencing a new `existingSecret`
3. Deploy as a separate Helm release in the same or different namespace

Each agent runs independently with its own Discord connection, memory, and optional worker pool.

## Resource Guidelines

| Agent Load | CPU Request | Memory Request | CPU Limit | Memory Limit |
|-----------|-------------|----------------|-----------|--------------|
| Low (< 10 messages/day) | 50m | 64Mi | 500m | 256Mi |
| Medium (10-100/day) | 100m | 128Mi | 1000m | 512Mi |
| High (100+/day) | 200m | 256Mi | 2000m | 1Gi |

Most CPU is spent on HTTP calls to the Claude API (network I/O, not compute).
