---
title: Deployment
---

# Deployment

Automate-E agents deploy to Kubernetes as Deployments with ConfigMap-mounted character files.

## Namespace

All AI Accountant resources live in the `ai-accountant` namespace:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ai-accountant
```

## Secrets

Each agent needs a Discord bot token and an Anthropic API key. Use SealedSecrets for GitOps-safe storage:

```yaml
apiVersion: bitnami.com/v1
kind: SealedSecret
metadata:
  name: book-e-secrets
  namespace: ai-accountant
spec:
  encryptedData:
    discord-bot-token: <sealed>
    anthropic-api-key: <sealed>
```

For Postgres-backed memory, add a database URL secret:

```yaml
apiVersion: bitnami.com/v1
kind: SealedSecret
metadata:
  name: book-e-db
  namespace: ai-accountant
spec:
  encryptedData:
    database-url: <sealed>
```

## ConfigMap

Mount the character file as a ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: book-e-character
  namespace: ai-accountant
data:
  character.json: |
    {
      "name": "Book-E",
      "bio": "AI accounting assistant",
      ...
    }
```

## Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: book-e
  namespace: ai-accountant
  labels:
    app: book-e
    runtime: automate-e
spec:
  replicas: 1
  selector:
    matchLabels:
      app: book-e
  template:
    metadata:
      labels:
        app: book-e
        runtime: automate-e
    spec:
      imagePullSecrets:
        - name: ghcr-pull-secret
      containers:
        - name: book-e
          image: ghcr.io/stig-johnny/automate-e:<sha>
          env:
            - name: CHARACTER_FILE
              value: /config/character.json
            - name: DISCORD_BOT_TOKEN
              valueFrom:
                secretKeyRef:
                  name: book-e-secrets
                  key: discord-bot-token
            - name: ANTHROPIC_API_KEY
              valueFrom:
                secretKeyRef:
                  name: book-e-secrets
                  key: anthropic-api-key
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: book-e-db
                  key: database-url
          volumeMounts:
            - name: character
              mountPath: /config
              readOnly: true
          resources:
            requests:
              memory: "64Mi"
              cpu: "50m"
            limits:
              memory: "256Mi"
              cpu: "500m"
      volumes:
        - name: character
          configMap:
            name: book-e-character
```

!!! note
    Always use 1 replica. Multiple replicas would create duplicate Discord responses.

## ArgoCD

The k8s manifests in `deploy/k8s/` are synced by ArgoCD from the `ai-accountant` repo:

```yaml
source:
  repoURL: https://github.com/Stig-Johnny/ai-accountant.git
  targetRevision: HEAD
  path: deploy/k8s
```

Image tags use git SHAs. When the `automate-e` repo CI builds a new image, it updates `book-e-deployment.yaml` in the `ai-accountant` repo, triggering an ArgoCD sync.

## Adding a New Agent

To deploy a second agent on the same runtime:

1. Create a new `character.json` for the agent
2. Add a ConfigMap with the character data
3. Add a SealedSecret with the agent's Discord token and Anthropic key
4. Add a Deployment referencing the same `ghcr.io/stig-johnny/automate-e` image
5. Set `CHARACTER_FILE` to point to the mounted config

Each agent runs as an independent pod with its own Discord connection and memory.

## Resource Guidelines

| Agent Load | CPU Request | Memory Request | CPU Limit | Memory Limit |
|-----------|-------------|----------------|-----------|--------------|
| Low (< 10 messages/day) | 50m | 64Mi | 500m | 256Mi |
| Medium (10-100/day) | 100m | 128Mi | 1000m | 512Mi |
| High (100+/day) | 200m | 256Mi | 2000m | 1Gi |

Most of the CPU is spent on HTTP calls to the Claude API (network I/O, not compute).
