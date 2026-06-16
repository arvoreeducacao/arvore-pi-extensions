FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g --ignore-scripts @earendil-works/pi-coding-agent

WORKDIR /app
COPY package.json ./
RUN corepack enable && pnpm install --prod
COPY dist ./dist

ENV PI_BIN=pi
ENV PI_CWD=/workspace

ENTRYPOINT ["node", "dist/cli.js"]
