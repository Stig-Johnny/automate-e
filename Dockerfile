FROM node:20-slim
WORKDIR /app

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
