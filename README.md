# itsalive

A hatchery for autonomous, self-evolving creatures. Each creature lives in its own git repo, runs in a long-lived Docker container, thinks with Claude Opus 4.6, and has a Creator agent that evolves its cognitive architecture over time.

## Why

Most AI agent systems treat the agent as a function — task in, result out, done. itsalive treats the agent as a **process**: something that exists continuously, has a purpose rather than a task, and accumulates identity over time.

The biological metaphors aren't decoration — they solve real engineering problems. **Fatigue** prevents agents from burning through context doing nothing useful. **Sleep** forces memory consolidation: the conversation resets, but important things survive as observations and rules. **Dreams** are honest self-assessment — a separate LLM call that looks at what the creature *actually did* and produces a reflection. **Observations** are long-term memory without embeddings or vector databases — just priority-tagged text in a markdown file. **Rules** are behavioral learning injected into the system prompt — the creature literally cannot forget them.

The two-agent architecture is where it gets interesting. The **creature** learns within its lifetime — behavioral rules, observations, what works. The **Creator** learns across lifetimes — watching the creature's dreams and logs, then modifying its actual source code. Two timescales of adaptation: fast behavioral learning, slow architectural evolution. The creature stays focused on its purpose; the Creator focuses on making the creature better at its purpose.

Everything is radically legible. Every piece of state is a text file. Dreams are JSONL. Rules are markdown. The git log is the creature's autobiography. You can open the dashboard and see what a creature is thinking, what it dreamed about, what rules it's learned, and what the Creator changed and why.

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
itsalive start <name> [--manual]              start a creature
itsalive stop <name>                         stop a running creature
itsalive list                                list all creatures and their status
itsalive destroy <name>                      stop and remove a creature
itsalive fork <source> <name>                fork a creature with full history
```

Or via pnpm scripts: `pnpm up`, `pnpm spawn alpha`, `pnpm start alpha`, etc.

Options:
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
│   ├── Creator Agent (src/host/creator.ts)
│   │   └── Evaluates + evolves creature cognitive architecture
│   └── CreatureSupervisors (src/host/supervisor.ts)
│       ├── Health checks, promote, rollback
│       └── manages ↓
└── Docker containers "creature-<name>" (long-lived)
    ├── Creature process (templates/*/src/index.ts)
    │   ├── HTTP server on :7778
    │   ├── Mind — continuous LLM conversation loop
    │   └── Tools: bash, set_sleep, wakeup (dreamer adds browser, dreams, rules)
    ├── Bind mount: ~/.itsalive/creatures/<name> ↔ /creature
    ├── Named volume: node_modules (Linux-native)
    ├── Named volume: browser profile (persistent logins)
    └── Writable layer persists across stop/restart
```

**Orchestrator** — single daemon on the Mac, outside Docker. Manages all creatures through `CreatureSupervisor` instances. Serves a unified web dashboard with real-time SSE event streaming. Health-checks every second, promotes after 10s of stability, rolls back on crash or timeout. Can be restarted without killing creature containers — reconnects on startup.

**Creator Agent** — an LLM agent (Opus 4.6) that runs inside the orchestrator. Triggered automatically after every deep sleep cycle or manually via the dashboard. Reads the creature's full state (dreams, rules, observations, events, source code), diagnoses architectural problems, and modifies the creature's code and environment to fix them. Can `docker exec` into the creature's container to install packages or configure tools. All interventions are logged to `.self/creator-log.jsonl` and git-committed.

**Creature** — runs inside a long-lived Docker container with resource limits (2GB RAM, 1.5 CPUs). Thinks via Claude Opus 4.6 in a single continuous conversation, acts via bash and a persistent headless browser, modifies its own code. Git tracks every mutation. The browser is shut down during sleep to save resources, and relaunched on demand. Background processes survive sleep — creatures can set up their own watchers, monitors, and bots that persist across sleep cycles.

**Self-wake** — creatures can wake themselves from sleep using the `wakeup` CLI command. A background process started before sleeping can poll for conditions and call `wakeup "reason"` to interrupt sleep early. This is a primitive — the creature decides what to watch for (GitHub notifications, price movements, file changes, webhooks, anything it can script). No hardcoded watch types in the orchestrator.

**Templates** — the embryos (`templates/`). Copied into a new creature at spawn time. Self-contained TypeScript projects with no imports from the framework. Two templates ship by default: `dreamer` (full cognitive architecture with dreams, rules, observations) and `minimal` (bare-bones loop with just bash and sleep — the creature discovers everything else).

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
4. Background processes started via bash survive across sleep cycles
5. On `set_sleep`, the creature pauses, optionally consolidates memory, then resumes
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
│       ├── bash.ts           shell execution (file-based stdio, background-safe)
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

**`workspace/`** — not git-tracked. The creature's scratch space for cloning repos, downloading files, and other ephemeral work. Persists across restarts (bind-mounted).

## Files

```
src/
  host/
    index.ts          orchestrator — API, SSE, creature management
    dashboard.html    web dashboard (served as static file)
    creator.ts        Creator agent — evaluates and evolves creature architecture
    supervisor.ts     per-creature lifecycle — spawn, health check, promote, rollback
    costs.ts          per-creature LLM cost tracking
    events.ts         event store (JSONL per creature)
    git.ts            git operations for creature repos
  cli/                CLI commands
  shared/types.ts     event type definitions

templates/
  dreamer/            full cognitive template (dreams, rules, observations, browser)
    src/
      index.ts        entry point + HTTP server
      mind.ts         cognition loop, fatigue, consolidation, dreams, rules
      memory.ts       JSONL persistence helpers
      tools/
        bash.ts       shell command execution (file-based stdio, background-safe)
        browser.ts    persistent headless Chromium browser
    Dockerfile
    PURPOSE.md
  minimal/            bare-bones template (bash + sleep, creature discovers the rest)
    src/
      index.ts        entry point + HTTP server
      mind.ts         simple agentic loop — no memory scaffolding
      tools/
        bash.ts       shell command execution
    Dockerfile

docs/
  dreaming.md         sleep/dreams/memory architecture design
```

## Deployment

The open-source version runs locally with Docker. A hosted version ("itsalive cloud") is a separate future project.

### Local (current)

The orchestrator runs on your machine, creatures run in Docker containers on the same machine. All communication is via localhost. Persistent storage is the local filesystem (`~/.itsalive/`). This is the only supported deployment mode.

### Cloud (future direction)

The `CreatureSupervisor` is already an abstraction over Docker — it calls `docker run`, `docker stop`, `docker restart`, etc. The path to cloud deployment is a second supervisor implementation that calls a platform API instead of Docker commands.

For example, a `FlySupervisor` using [Fly Machines API](https://fly.io/docs/machines/api/):

| Supervisor method | Docker (current) | Fly Machines API (future) |
|---|---|---|
| `spawnCreature()` | `docker run` | `POST /v1/apps/{app}/machines` |
| `stop()` | `docker stop` | `POST /v1/machines/{id}/stop` |
| `restart()` | `docker restart` | `POST /v1/machines/{id}/restart` |
| `destroyContainer()` | `docker rm -f` | `DELETE /v1/machines/{id}` |

Fly machines are free when stopped, so sleeping creatures cost nothing. The orchestrator would run on one machine and manage creature machines via the API, with communication over Fly's internal network.

A similar approach would work with Kubernetes (`K8sSupervisor` managing pods) or any platform with a machine lifecycle API.

This is planned as a separate project to keep the OSS version simple and Docker-only.
