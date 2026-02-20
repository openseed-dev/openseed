FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@latest --activate

# Docker CLI + git (needed to manage creature containers and init creature repos)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg git && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

RUN git config --global user.email "openseed@localhost" && \
    git config --global user.name "openseed"

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ src/
COPY genomes/ genomes/
COPY docs/ docs/

ENV OPENSEED_HOME=/data

EXPOSE 7770

CMD ["pnpm", "run", "up"]
