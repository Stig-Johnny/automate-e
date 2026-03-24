# Automate-E

Kubernetes-native AI agent runtime for Discord. Define an agent with a `character.json` config — no code needed.

## Features

- Character-driven configuration (personality, tools, memory)
- Discord gateway with thread-per-conversation
- Claude API agent loop with function calling
- Postgres-backed persistent memory (conversations, facts, patterns)
- Live dashboard with WebSocket (logs, sessions, tool calls, cost tracking)
- Helm chart for easy deployment
- Gateway/worker split for multi-replica scaling via Redis

## Quick Start

```bash
export DISCORD_BOT_TOKEN=...
export ANTHROPIC_API_KEY=...
export CHARACTER_FILE=./character.json

npm install
node src/index.js
```

## Deploy to Kubernetes

```bash
helm install my-agent charts/automate-e \
  --set secrets.existingSecret=my-agent-secrets \
  -f my-character-values.yaml
```

See [deployment docs](https://ai-accountant-yl9.pages.dev/automate-e/deployment/) for full guide.

## Character Config

Agents are defined by a JSON config file. See [configuration reference](https://ai-accountant-yl9.pages.dev/automate-e/configuration/).

## Architecture

```
Discord --> Gateway --> Agent Loop (Claude API) --> Tool Calls --> Reply
                              |
                        Postgres Memory
```

Single-process mode (default) or gateway+worker split with Redis for multiple replicas.

## Dashboard

Live monitoring at port 3000. Expose via Cloudflare Tunnel for remote access.

## First Agent: Book-E

AI accounting assistant for Invotek AS. Processes receipts, checks balances, tracks expenses via Folio and Fiken APIs.

- Dashboard: https://book-e.dashecorp.com
- Config: [Stig-Johnny/ai-accountant](https://github.com/Stig-Johnny/ai-accountant)

## License

Private - Invotek AS
