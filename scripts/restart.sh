#!/usr/bin/env bash
set -euo pipefail

PORT="${ORCHESTRATOR_PORT:-7770}"
JANEE_PORT="${JANEE_PORT:-3100}"

echo "[restart] stopping orchestrator on :$PORT ..."

# Find the node process that owns the LISTEN socket (skip SSE clients)
PID=$(lsof -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)

if [ -n "$PID" ]; then
  kill -TERM "$PID"
  echo "[restart] sent SIGTERM to $PID, waiting for exit ..."
  for i in $(seq 1 10); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$PID" 2>/dev/null; then
    echo "[restart] still alive after 10s, sending SIGKILL"
    kill -9 "$PID"
    sleep 1
  fi
else
  echo "[restart] nothing listening on :$PORT"
fi

# Safety net: give Janee up to 10s to exit on its own, then kill it
JANEE_PID=$(lsof -iTCP:"$JANEE_PORT" -sTCP:LISTEN -t 2>/dev/null || true)
if [ -n "$JANEE_PID" ]; then
  echo "[restart] waiting for janee (pid $JANEE_PID) on :$JANEE_PORT to exit ..."
  for i in $(seq 1 10); do
    kill -0 "$JANEE_PID" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$JANEE_PID" 2>/dev/null; then
    echo "[restart] janee still alive after 10s, sending SIGTERM"
    kill -TERM "$JANEE_PID"
    sleep 2
  fi
fi

echo "[restart] building dashboard ..."
(cd dashboard && pnpm build)

echo "[restart] starting orchestrator on :$PORT ..."
exec npx tsx src/host/index.ts
