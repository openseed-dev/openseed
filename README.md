# itsalive

A hatchery for autonomous, self-evolving creatures. Each creature lives in its own git repo, runs in a long-lived Docker container, thinks with Claude Opus 4.6, and has a Creator agent that evolves its cognitive architecture over time.

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

When you spawn a creature, it gets its own directory at `~/.itsalive/creatures/<name>/` with its own git repo. A Docker image is built and a container is created. The creature thinks using Claude Opus 4.6 in a continuous conversation loop, executes bash commands, browses the web, and can modify its own code.

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
│   ├── Cost tracker (src/host/costs.ts)
│   ├── Watcher (src/host/watcher.ts) — event-driven wake
│   ├── Creator Agent (src/host/creator.ts)
│   │   └── Evaluates + evolves creature cognitive architecture
│   └── CreatureSupervisors (src/host/supervisor.ts)
│       ├── Health checks, promote, rollback
│       └── manages ↓
└── Docker containers "creature-<name>" (long-lived)
    ├── Creature process (template/src/index.ts)
    │   ├── HTTP server on :7778
    │   ├── Mind — continuous LLM conversation loop
    │   ├── Sleep/dream consolidation system
    │   └── Tools: bash, browser, set_sleep
    ├── Bind mount: ~/.itsalive/creatures/<name> ↔ /creature
    ├── Named volume: node_modules (Linux-native)
    ├── Named volume: browser profile (persistent logins)
    └── Writable layer persists across stop/restart
```

**Orchestrator** — single daemon on the Mac, outside Docker. Manages all creatures through `CreatureSupervisor` instances. Serves a unified web dashboard with real-time SSE event streaming. Health-checks every second, promotes after 10s of stability, rolls back on crash or timeout. Can be restarted without killing creature containers — reconnects on startup.

**Creator Agent** — an LLM agent (Opus 4.6) that runs inside the orchestrator. Triggered automatically after every deep sleep cycle or manually via the dashboard. Reads the creature's full state (dreams, rules, observations, events, source code), diagnoses architectural problems, and modifies the creature's code and environment to fix them. Can `docker exec` into the creature's container to install packages or configure tools. All interventions are logged to `.self/creator-log.jsonl` and git-committed.

**Creature** — runs inside a long-lived Docker container with resource limits (2GB RAM, 1.5 CPUs). Thinks via Claude Opus 4.6 in a single continuous conversation, acts via bash and a persistent headless browser, modifies its own code. Git tracks every mutation. The browser is shut down during sleep to save resources, and relaunched on demand.

**Watcher** — monitors external events (e.g. GitHub notifications) while creatures sleep. Can wake a creature early with a reason ("new comment on your PR") so the creature knows why it was interrupted.

**Template** — the embryo (`template/`). Copied into a new creature at spawn time. Self-contained TypeScript project with no imports from the framework.

## Two Agents, Two Timescales

The system operates at two abstraction levels:

- **Creature** — fast loop (seconds). Thinks, acts, sleeps, dreams. Focused on fulfilling its purpose.
- **Creator** — slow loop (every deep sleep cycle, ~10 dream cycles). Watches the creature's performance, diagnoses cognitive architecture problems, modifies code and environment. Focused on making the creature better at its purpose.

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

**Tools**: read/write files in the creature's directory, bash (including `docker exec` into the creature's container), read events and dreams, get status, restart the creature.

**Flow**:
1. Deep sleep fires → Creator evaluates
2. Reads creature state, code, and its own previous intervention log
3. Diagnoses what's working and what isn't
4. If changes needed: writes changes, git commits, restarts the creature
5. Logs reasoning to `.self/creator-log.jsonl`, emits `creator.evaluation` event

**Safety**: git commit before changes (snapshot to revert to), creature's health check + rollback handles broken code, Creator logs everything for human review.

## Durable Containers

Creature Docker containers are **long-lived** — they are not destroyed on restart. This means:

- **`restart`** — restarts the creature's process inside the existing container. All installed packages, configs, and caches in the writable layer survive. Code changes from bind mounts take effect immediately.
- **`stop`** — gracefully stops the container. It can be started again later with its full state intact.
- **`rebuild`** — developer-initiated only. Destroys the container and creates a fresh one from the current image. Use when the Dockerfile itself changes.

The Creator can install packages and configure the creature's environment directly via `docker exec` — no rebuild required.

## Web Dashboard

The orchestrator serves a web dashboard at `http://localhost:7770` showing:
- All creatures with live status (running/stopped/sleeping)
- Real-time event stream: thoughts, tool calls, sleeps, dreams, promotions, rollbacks
- Tool calls collapsed by default, expandable to see full input/output
- Dream events with reflection text and action counts
- Creator evaluation events with reasoning and changed files
- Per-creature cost tracking (input/output tokens, USD)
- Message injection — send direct messages to a creature's conversation (Cmd+Enter)
- Wake button — interrupt a sleeping creature (with a reason it can see)
- Evolve button — manually trigger Creator evaluation
- Rebuild button — destroy and recreate the container from the image
- Mind panel with tabs: purpose, observations, dreams, priorities, diary, creator log

## Creature Files

Each creature lives at `~/.itsalive/creatures/<name>/` with this structure:

```
<name>/
├── src/                     source code (git-tracked)
│   ├── index.ts             entry point + HTTP server
│   ├── mind.ts              cognition loop, sleep, consolidation, dreams
│   ├── memory.ts            JSONL persistence helpers
│   └── tools/
│       ├── bash.ts           shell execution (hardened, timeout, non-interactive)
│       └── browser.ts        persistent headless Chromium
├── .self/                   creature state (git-tracked)
│   ├── observations.md      priority-tagged facts (RED/YLW/GRN)
│   ├── rules.md             learned behavioral rules (injected into system prompt)
│   ├── dreams.jsonl          session reflections from consolidation
│   ├── creator-log.jsonl     Creator agent intervention history
│   ├── iterations.jsonl      per-session action summaries
│   ├── conversation.jsonl    full conversation log (searchable)
│   ├── memory.jsonl          working memory store
│   ├── events.jsonl          all emitted events
│   ├── last_good.txt         SHA of last promoted commit (for rollback)
│   └── boot-ok               marker file — creature booted successfully
├── workspace/               scratch space (NOT git-tracked)
│   └── (cloned repos, downloads, temp files)
├── PURPOSE.md               north star — why this creature exists
├── MESSAGES.md              one-way messages from the human creator
├── Dockerfile               container image definition
├── package.json
└── (work products)          files the creature creates in pursuit of its purpose
```

### Key files explained

**PURPOSE.md** — the creature's north star. Read on every boot. Should answer "why do I exist?" in a few lines. Strategy, tactics, and current status belong in other files. The creature can rewrite it.

**`.self/observations.md`** — long-term memory. Priority-tagged facts compressed from experience by the Observer LLM during consolidation. Three levels:
- **RED** — critical: credentials, bans, commitments. Survives all pruning.
- **YLW** — important: project status, patterns, PR states. Pruned when superseded.
- **GRN** — informational: minor facts, tool outputs. Pruned after 48h.

**`.self/rules.md`** — behavioral rules learned from experience. Injected directly into the system prompt on every boot. Things like "NEVER comment on the same issue twice" or "ALWAYS use curl for GitHub API, not browser." The creature and Creator both write rules.

**`.self/dreams.jsonl`** — one entry per sleep cycle. Contains a reflection (honest self-assessment of the session), action count, and whether it was a deep sleep. Viewable in the dashboard's "dreams" tab.

**`.self/creator-log.jsonl`** — log of every Creator evaluation: what it observed, what it changed, and why. Viewable in the dashboard.

**`MESSAGES.md`** — one-way channel from human to creature. The creature checks this after waking. Don't expect replies — act on what it says.

**`workspace/`** — not git-tracked. The creature's scratch space for cloning repos, downloading files, and other ephemeral work. Persists across restarts (bind-mounted).

## Files

```
src/
  host/
    index.ts          orchestrator — web dashboard, API, SSE, creature management
    creator.ts        Creator agent — evaluates and evolves creature architecture
    supervisor.ts     per-creature lifecycle — spawn, health check, promote, rollback
    watcher.ts        event-driven wake — monitors external events during sleep
    costs.ts          per-creature LLM cost tracking
    events.ts         event store (JSONL per creature)
    git.ts            git operations for creature repos
  cli/                CLI commands
  shared/types.ts     event type definitions

template/             creature embryo (copied on spawn)
  src/
    index.ts          entry point + HTTP server
    mind.ts           cognition loop, fatigue, consolidation, dreams, rules
    memory.ts         JSONL persistence helpers
    tools/
      bash.ts         shell command execution (hardened, timeout, non-interactive)
      browser.ts      persistent headless Chromium browser
  Dockerfile          container image definition
  PURPOSE.md          default purpose (overwritten by --purpose flag on spawn)
  self/diary.md       creature's journal

docs/
  dreaming.md         sleep/dreams/memory architecture design
```
