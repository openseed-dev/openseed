#!/bin/sh
set -e

pnpm install --frozen-lockfile 2>/dev/null || true

# Ensure latest Janee Runner
npm install -g @true-and-useful/janee@latest --prefer-online 2>/dev/null || true

# Start Janee Runner if Authority URL is set
if [ -n "$JANEE_AUTHORITY_URL" ] && [ -n "$JANEE_RUNNER_KEY" ]; then
  janee serve -t http -p 3200 --host 127.0.0.1 \
    --authority "$JANEE_AUTHORITY_URL" \
    --runner-key "$JANEE_RUNNER_KEY" &
  JANEE_PID=$!

  for i in $(seq 1 10); do
    if curl -sf http://localhost:3200/mcp >/dev/null 2>&1; then
      echo "[janee-runner] ready on localhost:3200"
      break
    fi
    sleep 1
  done
fi

exec npx tsx src/index.ts
