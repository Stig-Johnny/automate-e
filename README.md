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

## Character Config

Agents are defined by a JSON file with personality, tools, and LLM settings:

```json
{
  "name": "My Agent",
  "personality": "You are a helpful assistant...",
  "discord": { "channels": ["#general"] },
  "tools": [
    {
      "url": "http://my-api:8080",
      "endpoints": [
        { "method": "GET", "path": "/data", "description": "Fetch data" }
      ]
    }
  ],
  "llm": { "model": "claude-haiku-4-5-20251001", "temperature": 0.3 }
}
```

See `examples/example-e/` for a complete example.

## Architecture

```
Discord --> Gateway --> Agent Loop (Claude API) --> Tool Calls --> Reply
                              |
                        Postgres Memory
```

**Single-process mode** (default): `node src/index.js` — one process handles everything.

**Gateway + Worker mode**: Scale workers independently via Redis Streams.

```
Discord --> Gateway (1 replica) --> Redis Streams --> Worker (N replicas) --> Discord REST API
```

## Deploy to Kubernetes

```bash
helm install my-agent charts/automate-e \
  --set secrets.existingSecret=my-agent-secrets \
  -f my-character-values.yaml
```

See the [deployment docs](https://stig-johnny.github.io/automate-e/deployment/) for Kubernetes and ArgoCD setup.

## Dashboard

Live monitoring dashboard at port 3000 with WebSocket updates:

- Active sessions and message counts
- Tool call history with latency
- Token usage and cost per model
- Live log stream

Expose externally via Cloudflare Tunnel or any ingress.

## Project Structure

```
src/
  index.js          # Single-process mode (Discord + agent in one process)
  gateway.js        # Gateway mode (Discord → Redis)
  worker.js         # Worker mode (Redis → Claude API → Discord REST)
  test.js           # Test mode (web chat, no Discord required)
  agent.js          # Claude API agent loop with tool calling
  character.js      # Character config loader and validator
  memory.js         # Postgres memory (conversations, facts, patterns)
  usage.js          # Token usage tracking and cost calculation
  dashboard/        # Live monitoring dashboard (HTTP + WebSocket)
charts/automate-e/  # Helm chart
examples/example-e/ # Example: simple demo agent
```

## License

MIT — see [LICENSE](LICENSE)
