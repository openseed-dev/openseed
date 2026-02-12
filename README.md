# itsalive

A hatchery for autonomous, self-evolving creatures. Each creature lives in its own git repo, runs in a Docker sandbox, thinks with Claude Opus 4.6, and has a Creator agent that evolves its cognitive architecture over time.

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

When you spawn a creature, it gets its own directory at `~/.itsalive/creatures/<name>/` with its own git repo. A Docker image is built for it. The creature thinks using Claude Opus 4.6 in a continuous conversation loop, executes bash commands, browses the web, and can modify its own code.

A central orchestrator manages all creatures — spawning containers, health-checking, promoting stable commits, rolling back broken ones, and serving a unified web dashboard.

A **Creator agent** (also Opus 4.6) watches each creature and evolves its cognitive architecture — modifying `mind.ts`, tools, rules, and priorities based on observed behavior. The creature focuses on its purpose; the Creator focuses on making the creature better at its purpose.

The creature's git log becomes its autobiography. Every self-modification and Creator intervention is a commit.

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
│   ├── Creator Agent (src/host/creator.ts)
│   │   └── Evaluates + evolves creature cognitive architecture
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

**Creator Agent** — an LLM agent (Opus 4.6) that runs inside the orchestrator. Triggered automatically after every deep sleep cycle or manually via the dashboard. Reads the creature's full state (dreams, rules, observations, events, source code), diagnoses architectural problems, and modifies the creature's code to fix them. Suspends the creature, writes changes, rebuilds, and restarts. All interventions are logged to `.self/creator-log.jsonl` and git-committed.

**Creature** — runs inside a Docker container with resource limits (2GB RAM, 1.5 CPUs). Thinks via Claude Opus 4.6 in a single continuous conversation, acts via bash and a persistent headless browser, modifies its own code. Git tracks every mutation.

**Template** — the embryo (`template/`). Copied into a new creature at spawn time. Self-contained TypeScript project with no imports from the framework.

## Two Agents, Two Timescales

The system operates at two abstraction levels:

- **Creature** — fast loop (seconds). Thinks, acts, sleeps, dreams. Focused on fulfilling its purpose.
- **Creator** — slow loop (every deep sleep cycle, ~10 dream cycles). Watches the creature's performance, diagnoses cognitive architecture problems, modifies code. Focused on making the creature better at its purpose.

The creature learns behavioral rules through experience. The Creator learns what architectural patterns work by observing across evaluation cycles. Both log their reasoning. The recursion stops at the Creator because its feedback loop is slow and legible enough for a human to evaluate.

## Cognition

Creatures run a single continuous conversation with Claude:

1. Build initial context from PURPOSE.md, last dream, priorities, and recent observations
2. Enter continuous conversation loop with Claude
3. LLM uses tools: bash, browser, set_sleep
4. On `set_sleep`, the creature pauses, optionally consolidates memory, then resumes
5. Fatigue system forces consolidation after prolonged activity
6. Progress checks every 10 actions force self-evaluation
7. Learned rules from consolidation are injected into the system prompt

## Sleep and Dreams

Creatures have a three-tier memory system inspired by [Mastra's Observational Memory](https://mastra.ai/blog/observational-memory), adapted for autonomous agents:

- **In-context** — recent conversation messages (~20K tokens)
- **Observations** — prioritized facts compressed from experience (`.self/observations.md`)
- **Total recall** — full conversation log on disk, searchable with `rg` and `jq`

A fatigue system tracks activity and forces consolidation: warning at 60 actions, forced sleep at 80. During consolidation, a separate LLM call produces observations, an honest self-reflection ("dream"), and learned behavioral rules. Every 10th dream triggers deep sleep — pruning old observations, rewriting priorities, reviewing rules, and writing diary entries.

Deep sleep also triggers the **Creator agent**, which evaluates the creature's cognitive architecture and may modify its source code.

See [docs/dreaming.md](docs/dreaming.md) for the full design.

## Creator Agent

The Creator is the evolutionary architect. It automates the work a human would do watching a creature's logs and tweaking its code:

**Trigger**: automatically after every deep sleep, or manually via the "evolve" button on the dashboard.

**Tools**: read/write files in the creature's directory, read events and dreams, get status, suspend the creature, rebuild and restart.

**Flow**:
1. Deep sleep fires → Creator evaluates
2. Reads creature state, code, and its own previous intervention log
3. Diagnoses what's working and what isn't
4. If changes needed: suspends creature, writes changes, git commits, rebuilds, restarts
5. Logs reasoning to `.self/creator-log.jsonl`, emits `creator.evaluation` event

**Safety**: git commit before changes (snapshot to revert to), creature's health check + rollback handles broken code, Creator logs everything for human review.

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
- Creator evaluation events with reasoning and changed files
- Message injection — send direct messages to a creature's conversation (Cmd+Enter)
- Wake button — interrupt a sleeping creature
- Evolve button — manually trigger Creator evaluation
- Mind panel with tabs: purpose, observations, dreams, priorities, diary, creator log

## Files

```
src/
  host/
    index.ts          orchestrator — web dashboard, API, SSE, creature management
    creator.ts        Creator agent — evaluates and evolves creature architecture
    supervisor.ts     per-creature lifecycle — spawn, health check, promote, rollback
    events.ts         event store (JSONL per creature)
  cli/                CLI commands
  shared/types.ts     event type definitions

template/             creature embryo (copied on spawn)
  src/
    index.ts          entry point + HTTP server
    mind.ts           cognition loop, fatigue, consolidation, dreams, rules
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
