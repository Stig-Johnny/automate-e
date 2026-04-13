# Automate-E

Kubernetes-native AI agent runtime for Discord. Define an agent with a `character.json` config — no code needed.

## Features

- Character-driven configuration (personality, tools, memory)
- Discord gateway with thread-per-conversation
- Multiple LLM execution modes: Anthropic SDK, Claude Code CLI, and Codex CLI
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
Discord --> Gateway --> Agent Loop --> Provider Chain --> LLM --> Tool Calls --> Reply
                              |               |
                        Postgres Memory   MCP Servers
```

**Single-process mode** (default): `node src/index.js` — one process handles everything.

**Gateway + Worker mode**: Scale workers independently via Redis Streams.

```
Discord --> Gateway (1 replica) --> Redis Streams --> Worker (N replicas) --> Discord REST API
```

### Stream Consumer Pattern

In gateway/worker mode, the gateway writes incoming Discord messages to a Redis Stream (`automate-e:messages`). Workers consume the stream using `XREADGROUP` with `BLOCK`, so they wait with zero CPU cost until a message arrives. Each message is acknowledged (`XACK`) only after the agent successfully processes it — unacknowledged messages are retried on worker restart.

The same pattern is used for **agent assignments** from Conductor-E (`src/stream-consumer.js`). Assignments arrive on a per-agent stream (`assignments:<agentId>`), are claimed via a consumer group, and ACKed only after the agent completes the task. On startup, any pending (unACKed) messages from a previous run are processed first.

### Provider Chain

Automate-E supports multiple LLM backends. The active provider is determined at runtime by `src/agent/provider-state.js`. Available providers:

| Provider key | Description |
|---|---|
| `anthropic` | Anthropic SDK (default) |
| `claude-cli` | Claude Code CLI subprocess |
| `codex-cli` | OpenAI Codex CLI subprocess |
| `openai-api` | OpenAI API |

Configure the primary provider in `character.json` via `llm.provider`. Additional fallback providers are listed under `llm.providers`. The chain is built at startup (`src/agent/provider-chain.js`) and only one provider runs at a time.

### character.json Config

Everything about an agent is declared in a single JSON file — no code needed:

```json
{
  "name": "My Agent",
  "personality": "System prompt / persona for the LLM",
  "discord": { "channels": ["#my-channel"] },
  "tools": [
    {
      "url": "http://my-api:8080",
      "endpoints": [
        { "method": "GET", "path": "/data", "description": "Fetch data" }
      ]
    }
  ],
  "mcpServers": {
    "my-server": { "command": "npx", "args": ["-y", "my-mcp-package"] }
  },
  "llm": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "temperature": 0.3,
    "providers": {
      "claude-cli": { "model": "claude-sonnet-4-5" }
    }
  }
}
```

Point to it via `CHARACTER_FILE=./character.json`. Required fields: `name`, `personality`, `tools`, `llm`. The loader (`src/character.js`) validates the file at startup and exits with a clear error if anything is missing.

### MCP Server Integration

Automate-E connects to any number of [Model Context Protocol](https://modelcontextprotocol.io) servers defined under `mcpServers` in `character.json`. Each server is launched as a subprocess via stdio transport. Tools exposed by the server are prefixed with `mcp_<serverName>_` to avoid naming collisions and are injected into the agent's tool list automatically.

```
Agent Loop --> callTool("mcp_context7_search", {...})
                    |
              mcp.js routes to the right MCP subprocess
                    |
              MCP server returns result --> LLM continues
```

See `examples/example-e/character.json` for a working `mcpServers` configuration.

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

MIT License. See LICENSE file.

## Contributing

Not accepting contributions at this time. This is maintained by Invotek AS.

## Support

For help, [open a GitHub issue](https://github.com/Stig-Johnny/automate-e/issues/new).
