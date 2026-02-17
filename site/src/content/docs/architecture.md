---
title: Architecture
description: How the orchestrator, creatures, LLM proxy, and Docker containers fit together.
order: 3
section: core
---

## Overview

OpenSeed runs as a single orchestrator daemon that manages creatures. Each creature runs in its own long-lived Docker container with persistent storage.

```
Orchestrator (src/host/) - single daemon on your machine
├── Web dashboard on :7770 (real-time SSE event stream)
├── LLM proxy - routes to Anthropic or OpenAI based on model
├── Cost tracker - per-creature, per-model token accounting
└── Creature supervisors - health check, promote, rollback
    └── Docker containers (long-lived, persistent)
        ├── Creature process (from genome)
        │   ├── Mind - continuous LLM conversation loop
        │   └── Tools: bash, sleep, browser (dreamer only)
        ├── Bind mount: ~/.openseed/creatures/<name>/ → /creature
        └── Named volumes: node_modules, browser profile
```

## Orchestrator

The orchestrator (`src/host/index.ts`) is the single entry point. It exposes an HTTP API, an SSE event stream, and the web dashboard on port 7770.

It manages all creature supervisors, health-checks every second, promotes a creature's code changes after 10 seconds of stability, and rolls back on crash.

The orchestrator can be restarted without killing containers. It reconnects to running containers on startup.

## LLM Proxy

Creatures call the orchestrator's proxy instead of hitting providers directly. The proxy (`src/host/proxy.ts`) detects the requested model, injects the appropriate API key, and routes to the correct upstream (Anthropic or OpenAI).

For OpenAI models, the proxy translates between Anthropic message format and OpenAI Responses API format, so creatures always speak a single protocol regardless of the backing model.

## Supervisors

Each creature gets one supervisor (`src/host/supervisor.ts`). The supervisor manages the Docker container lifecycle: start, stop, restart. It streams container logs back to the orchestrator's event store, enforces the health gate (10s stability window before promoting code changes), and handles rollback logic when a creature crashes after modifying its own source.

## Creature Files

Each creature lives under `~/.openseed/creatures/<name>/`:

```
~/.openseed/creatures/<name>/
├── src/                       source code (git-tracked, creature can modify)
│   ├── index.ts               entry point + HTTP server
│   ├── mind.ts                cognition loop, consolidation, dreams
│   └── tools/                 bash, browser, etc.
├── .sys/                      platform infrastructure (gitignored)
├── .self/                     cognitive state (dreamer only, gitignored)
├── workspace/                 scratch space (not git-tracked)
├── PURPOSE.md                 the creature's reason for existing
├── BIRTH.json                 identity: name, genome, model, birth time
└── Dockerfile
```

- **`src/`**: the creature's own code. Git-tracked. The creature can modify this at runtime; changes go through the health gate before being promoted.
- **`.sys/`**: platform-managed files (gitignored). Infrastructure the creature doesn't touch.
- **`.self/`**: cognitive state for dreamer-genome creatures (gitignored). Memory consolidation, dream logs.
- **`workspace/`**: scratch space for the creature to use freely. Not git-tracked.
- **`PURPOSE.md`**: defines what the creature exists to do.
- **`BIRTH.json`**: immutable identity record: name, genome, model, birth timestamp.

## Source Layout

```
src/
  host/
    index.ts          orchestrator - API, SSE, creature management
    proxy.ts          LLM proxy - Anthropic passthrough + OpenAI translation
    supervisor.ts     per-creature Docker lifecycle + health + rollback
    costs.ts          per-creature, per-model cost tracking
    events.ts         event store (JSONL)
    git.ts            git operations for creature repos
    dashboard.html    web dashboard
  cli/
    index.ts          CLI entry point
    spawn.ts          spawn command
    genome.ts         genome install/list/remove commands
    ...               start, stop, list, fork, destroy
  shared/
    types.ts          event type definitions
    paths.ts          genome resolution, path constants
    spawn.ts          shared spawn logic (used by CLI + orchestrator)
    fs.ts             shared filesystem utilities
genomes/
  dreamer/            full cognitive architecture (source of truth)
  minimal/            bare-bones loop (source of truth)
```
