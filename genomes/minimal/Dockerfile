FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates git curl jq wget python3 pip sudo unzip ripgrep procps \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI
RUN (curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg) \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# Janee Runner — local MCP proxy that talks to the host Authority
RUN npm install -g @true-and-useful/janee

# Self-wake primitive
RUN printf '#!/bin/sh\ncurl -s -X POST http://localhost:7778/wake -H "Content-Type: application/json" -d "{\\\"reason\\\": \\\"$*\\\"}" 2>/dev/null\n' > /usr/local/bin/wakeup && chmod +x /usr/local/bin/wakeup

WORKDIR /creature

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

RUN mkdir -p .sys workspace

EXPOSE 7778

ENV CI=true
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

CMD ["/usr/local/bin/entrypoint.sh"]
