# itsalive

A hatchery for autonomous, self-modifying creatures. Each creature lives in its own git repo, runs in a Docker sandbox, evolves its own code, and survives failures through automatic rollback.

## Quick start

```bash
# Clone and install
git clone git@github.com:rsdouglas/itsalive.git
cd itsalive && pnpm install

# Set your Anthropic API key
export ANTHROPIC_API_KEY="sk-ant-..."

# Start Docker, then start the orchestrator
pnpm up

# Spawn and start a creature
pnpm spawn alpha --purpose "explore the world"
pnpm start alpha

# Open the dashboard
open http://localhost:7770
```

## What happens

When you spawn a creature, it gets its own directory at `~/.itsalive/creatures/<name>/` with its own git repo. A Docker image is built for it. The creature thinks using Claude in a continuous conversation loop, executes bash commands, browses the web, and can modify its own code.

A central orchestrator manages all creatures — spawning containers, health-checking, promoting stable commits, rolling back broken ones, and serving a unified web dashboard.

The creature's git log becomes its autobiography. Every self-modification is a commit.

## CLI

```
itsalive up                                  start the orchestrator + dashboard
itsalive spawn <name> [--purpose "..."]      create a new creature (builds Docker image)
itsalive start <name> [--manual] [--bare]    start a creature
itsalive stop <name>                         stop a running creature
itsalive list                                list all creatures and their status
itsalive destroy <name>                      stop and remove a creature
itsalive fork <source> <name>                fork a creature with full history
```

Or via pnpm scripts: `pnpm up`, `pnpm spawn alpha`, `pnpm start alpha`, etc.

Options:
- `--bare` — run without Docker sandbox (uses local node directly)
- `--manual` — don't auto-start the cognition loop

## Architecture

```
Your Mac
├── itsalive CLI (src/cli/)
│   └── talks to ↓
├── Orchestrator (src/host/index.ts) — single long-lived daemon
│   ├── Unified web dashboard on :7770
│   ├── SSE event stream for real-time updates
│   ├── REST API for creature management
│   └── CreatureSupervisors (src/host/supervisor.ts)
│       ├── Health checks, promote, rollback
│       └── spawns ↓
└── Docker containers "creature-<name>"
    ├── Creature process (template/src/index.ts)
    │   ├── HTTP server on :7778
    │   ├── Mind — continuous LLM conversation loop
    │   ├── Sleep/dream consolidation system
    │   └── Tools: bash, browser, set_sleep
    ├── Bind mount: ~/.itsalive/creatures/<name> ↔ /creature
    ├── Named volume: node_modules (Linux-native)
    └── Named volume: browser profile (persistent logins)
```

**Orchestrator** — single daemon on the Mac, outside Docker. Manages all creatures through `CreatureSupervisor` instances. Serves a unified web dashboard with real-time SSE event streaming. Health-checks every second, promotes after 10s of stability, rolls back on crash or timeout. Can be restarted without killing creature containers — reconnects on startup.

**Creature** — runs inside a Docker container with resource limits (2GB RAM, 1.5 CPUs). Thinks via Claude in a single continuous conversation, acts via bash and a persistent headless browser, modifies its own code. Git tracks every mutation.

**Template** — the embryo (`template/`). Copied into a new creature at spawn time. Self-contained TypeScript project with no imports from the framework.

## Cognition

Creatures run a single continuous conversation with Claude:

1. Build initial context from PURPOSE.md, last dream, priorities, and recent observations
2. Enter continuous conversation loop with Claude
3. LLM uses tools: bash, browser, set_sleep
4. On `set_sleep`, the creature pauses, optionally consolidates memory, then resumes
5. Fatigue system forces consolidation after prolonged activity

## Sleep and Dreams

Creatures have a three-tier memory system inspired by [Mastra's Observational Memory](https://mastra.ai/blog/observational-memory), adapted for autonomous agents:

- **In-context** — recent conversation messages (~20K tokens)
- **Observations** — prioritized facts compressed from experience (`.self/observations.md`)
- **Total recall** — full conversation log on disk, searchable with `rg` and `jq`

A fatigue system tracks activity and forces consolidation: warning at 60 actions, forced sleep at 80. During consolidation, a separate LLM call produces observations and an honest self-reflection ("dream"). Every 10th dream triggers deep sleep — pruning old observations, rewriting priorities, and writing diary entries.

See [docs/dreaming.md](docs/dreaming.md) for the full design.

## Docker Sandboxing

Creatures run in Docker containers for isolation:
- Filesystem: bind-mounted creature directory, separate named volumes for node_modules and browser profile
- Resources: memory and CPU limits
- Network: communicates with orchestrator via `host.docker.internal`
- Browser: Playwright Chromium with a persistent profile across restarts
- Tools: git, curl, jq, rg, python3, wget, sudo, unzip pre-installed

Use `--bare` to skip Docker and run directly on the host (useful for debugging).

## Web Dashboard

The orchestrator serves a web dashboard at `http://localhost:7770` showing:
- All creatures with live status (running/stopped/sleeping)
- Real-time event stream: thoughts, tool calls, sleeps, dreams, promotions, rollbacks
- Tool calls collapsed by default, expandable to see full input/output
- Dream events with reflection and priority text
- Message injection — send direct messages to a creature's conversation (Cmd+Enter)

## Files

```
src/
  host/
    index.ts          orchestrator — web dashboard, API, SSE, creature management
    supervisor.ts     per-creature lifecycle — spawn, health check, promote, rollback
    events.ts         event store (JSONL per creature)
  cli/                CLI commands
  shared/types.ts     event type definitions

template/             creature embryo (copied on spawn)
  src/
    index.ts          entry point + HTTP server
    mind.ts           cognition loop, fatigue, consolidation, dreams
    memory.ts         JSONL persistence
    tools/
      bash.ts         shell command execution (hardened, timeout, non-interactive)
      browser.ts      persistent headless Chromium browser
  Dockerfile          container image definition
  PURPOSE.md          default purpose/attractor
  self/diary.md       creature's journal

docs/
  dreaming.md         sleep/dreams/memory architecture design
```
