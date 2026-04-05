FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl jq && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install Claude Code CLI — required for OAuth subscription token (sk-ant-oat) mode
RUN npm install -g @anthropic-ai/claude-code

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
