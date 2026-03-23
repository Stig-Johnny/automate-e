FROM node:20-slim
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src/ src/

ENV CHARACTER_FILE=/config/character.json

USER node
CMD ["node", "src/index.js"]
