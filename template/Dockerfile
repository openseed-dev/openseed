FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates git curl jq wget python3 pip sudo unzip ripgrep \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /creature

# Install deps first for layer caching
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Install Playwright Chromium + system deps
RUN npx playwright install --with-deps chromium

# Copy creature code
COPY . .

RUN mkdir -p .self

EXPOSE 7778

CMD ["npx", "tsx", "src/index.ts"]
