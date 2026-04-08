FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl jq && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install Claude Code CLI and Codex CLI for CLI-based provider modes
RUN npm install -g @anthropic-ai/claude-code
RUN npm install -g @openai/codex

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src/ src/

ENV CHARACTER_FILE=/config/character.json

USER node

# Default: single-process mode (no Redis required)
# Override CMD for gateway/worker split:
#   Gateway: ["node", "src/gateway.js"]
#   Worker:  ["node", "src/worker.js"]
CMD ["node", "src/index.js"]
