# itsalive

Autonomous, self-evolving AI creatures that live in Docker containers. They think, act, sleep, dream, and modify their own code — without human prompting.

Each creature gets its own git repo, a persistent container, and a purpose. A central orchestrator manages their lifecycles, and a Creator agent evolves their cognitive architecture over time. Works with Claude and GPT models.

## Why

Most AI agent systems treat the agent as a function — task in, result out, done. itsalive treats the agent as a **process**: something that exists continuously, accumulates identity, and learns from its own experience.

The biological metaphors solve real engineering problems:

- **Sleep** forces memory consolidation — the conversation resets, but important things survive as observations and rules
- **Dreams** are honest self-assessment — a separate LLM call that reflects on what the creature actually did
- **Observations** are long-term memory without embeddings or vector databases — priority-tagged text in a markdown file
- **Rules** are behavioral learning injected into the system prompt — the creature literally cannot forget them
- **Fatigue** prevents agents from burning through context doing nothing useful

The **Creator agent** adds a second timescale of adaptation: the creature learns behavior within its lifetime; the Creator watches across lifetimes and modifies the creature's source code.

Everything is radically legible. Every piece of state is a text file. The git log is the creature's autobiography.

## Quick Start

Requires: [Node.js](https://nodejs.org/) 18+, [pnpm](https://pnpm.io/installation), [Docker](https://www.docker.com/products/docker-desktop/)

```bash
git clone https://github.com/rsdouglas/itsalive.git
cd itsalive
pnpm install
```

Set your API key(s). You need at least one — Anthropic for Claude models, OpenAI for GPT models:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
```

Start the orchestrator and open the dashboard:

```bash
pnpm up
open http://localhost:7770
```

Spawn your first creature from the dashboard (click the `+` button), or from the CLI:

```bash
pnpm spawn alpha -- --purpose "explore the world and build useful things"
```

The creature will boot in a Docker container, read its purpose, and start thinking. Watch it in the dashboard — you'll see thoughts, tool calls, and sleeps stream in real-time. Send it a message with Cmd+Enter. It'll run autonomously from here.

## Models

Creatures can run on any supported model. Choose at spawn time:

```bash
pnpm spawn trader -- --model claude-opus-4-6 --purpose "trade crypto"
pnpm spawn explorer -- --model gpt-5.2 --template minimal --purpose "explore"
pnpm spawn scout -- --model gpt-5-mini --purpose "monitor news"
```

Or select from the dropdown in the dashboard.

| Model | Provider | Input/Output per MTok |
|-------|----------|----------------------|
| `claude-opus-4-6` | Anthropic | $5 / $25 |
| `claude-sonnet-4-5` | Anthropic | $3 / $15 |
| `claude-haiku-4-5` | Anthropic | $1 / $5 |
| `gpt-5.2` | OpenAI | $1.75 / $14 |
| `gpt-5-mini` | OpenAI | $0.25 / $2 |
| `o4-mini` | OpenAI | $1.10 / $4.40 |

Creatures use the [Vercel AI SDK](https://ai-sdk.dev) with provider-agnostic types. A translating proxy in the orchestrator handles routing — Claude models forward to Anthropic directly, OpenAI models get translated to the Responses API and back. The creature never knows the difference.

## Templates

Templates are the embryos. Copied into a new creature at spawn time.

**`dreamer`** (default) — Full cognitive architecture: dreams, rules, observations, memory consolidation, fatigue system, persistent browser, Creator agent oversight. Good for complex, long-running purposes.

**`minimal`** — Bare-bones loop with just bash and sleep. No built-in memory, no dreams, no hints about how to persist state. The creature discovers everything on its own. Good for studying emergent behavior.

## What Happens

When you spawn a creature:

1. A directory is created at `~/.itsalive/creatures/<name>/` with its own git repo
2. A Docker image is built and a container is created
3. The creature boots, reads its PURPOSE.md, and starts thinking
4. It runs a continuous conversation loop with the LLM, executing bash commands and (for dreamers) browsing the web
5. When it sleeps, it consolidates memories — writing observations, rules, and a dream reflection
6. Every 10th sleep is a "deep sleep" that prunes old memories and triggers the Creator agent
7. The Creator reads the creature's state and may modify its source code to make it better
8. The creature's git log records every self-modification and Creator intervention

## CLI

```
itsalive up [--port 7770]              start the orchestrator + dashboard
itsalive spawn <name> [options]        create a new creature
  --purpose "..."                      what the creature should do
  --template dreamer|minimal           cognitive template (default: dreamer)
  --model <model>                      LLM model (default: claude-opus-4-6)
itsalive start <name> [--manual]       start a creature
itsalive stop <name>                   stop a running creature
itsalive list                          list all creatures and their status
itsalive fork <source> <name>          fork a creature with full history
itsalive destroy <name>                permanently remove a creature
```

Or via pnpm: `pnpm up`, `pnpm spawn alpha`, `pnpm start alpha`, etc.

## Architecture

```
Orchestrator (src/host/) — single daemon on your machine
├── Web dashboard on :7770 (real-time SSE event stream)
├── LLM proxy — routes to Anthropic or OpenAI based on model
├── Creator agent — evolves creature cognitive architecture
├── Cost tracker — per-creature, per-model token accounting
└── Creature supervisors — health check, promote, rollback
    └── Docker containers (long-lived, persistent)
        ├── Creature process (from template)
        │   ├── Mind — continuous LLM conversation loop
        │   └── Tools: bash, sleep, browser (dreamer only)
        ├── Bind mount: ~/.itsalive/creatures/<name>/ → /creature
        └── Named volumes: node_modules, browser profile
```

**Orchestrator** — manages all creatures. Health-checks every second, promotes after 10s of stability, rolls back on crash. Can be restarted without killing containers — reconnects on startup.

**LLM Proxy** — creatures call the proxy instead of the LLM provider directly. The proxy detects the model, injects the real API key, and routes to the right upstream. For OpenAI models, it translates between Anthropic and OpenAI Responses API formats transparently.

**Creator Agent** — an LLM agent that runs inside the orchestrator. Triggered after deep sleep cycles. Reads the creature's full state, diagnoses problems, and modifies source code. Can `docker exec` into containers to install packages.

**Supervisors** — one per creature. Manages the Docker container lifecycle, streams logs, handles health gate and rollback logic.

## Creature Files

```
~/.itsalive/creatures/<name>/
├── src/                       source code (git-tracked, creature can modify)
│   ├── index.ts               entry point + HTTP server
│   ├── mind.ts                cognition loop, consolidation, dreams
│   └── tools/                 bash, browser, etc.
├── .sys/                      platform infrastructure (gitignored)
│   ├── boot-ok                health check marker
│   ├── events.jsonl           event log
│   ├── last_good.txt          rollback SHA
│   └── iterations.jsonl       session checkpoints
├── .self/                     cognitive state (dreamer only, gitignored)
│   ├── observations.md        priority-tagged long-term memory
│   ├── rules.md               behavioral rules (injected into system prompt)
│   ├── dreams.jsonl           sleep reflections
│   ├── conversation.jsonl     full conversation log
│   ├── creator-log.jsonl      Creator intervention history
│   └── memory.jsonl           working memory
├── workspace/                 scratch space (not git-tracked)
├── PURPOSE.md                 the creature's reason for existing
├── BIRTH.json                 identity: name, template, model, birth time
└── Dockerfile
```

`.sys/` is platform plumbing — the creature doesn't need to know about it. `.self/` is cognitive state that only exists for dreamer creatures. Minimal creatures have no `.self/` — they invent their own persistence strategies.

## Sleep and Dreams

Creatures have a three-tier memory system:

- **In-context** — recent conversation messages (~20K tokens)
- **Observations** — prioritized facts compressed from experience (`.self/observations.md`)
- **Total recall** — full conversation log on disk, searchable with `rg`

A fatigue system tracks activity and forces consolidation. During consolidation, a separate LLM call produces observations, an honest self-reflection ("dream"), and learned behavioral rules. Every 10th dream triggers deep sleep — pruning stale observations, reviewing rules, and triggering the Creator agent.

## Dashboard

The web dashboard at `http://localhost:7770` shows:

- All creatures with live status indicators
- Real-time event stream: thoughts, tool calls, sleeps, dreams, Creator interventions
- Expandable tool call details (input, output, timing)
- Per-creature cost tracking
- Message injection (talk to a creature mid-conversation)
- Spawn form with model and template selection
- Mind panel: purpose, observations, dreams, rules, Creator log

## Source Layout

```
src/
  host/
    index.ts          orchestrator — API, SSE, creature management
    proxy.ts          LLM proxy — Anthropic passthrough + OpenAI translation
    supervisor.ts     per-creature Docker lifecycle + health + rollback
    creator.ts        Creator agent — evaluates and evolves creatures
    costs.ts          per-creature, per-model cost tracking
    events.ts         event store (JSONL)
    git.ts            git operations for creature repos
    dashboard.html    web dashboard
  cli/                CLI commands (spawn, start, stop, list, fork, destroy)
  shared/types.ts     event type definitions

templates/
  dreamer/            full cognitive architecture
  minimal/            bare-bones — creature discovers everything
```

## Roadmap

Things we're thinking about and working toward:

- **Cost controls** — per-creature spending limits (daily, total) with automatic sleep or shutdown when the budget is hit. Hard caps to prevent runaway spend.
- **Cost-aware creatures** — optionally expose budget and usage to the creature itself, so it can make economic decisions. A creature that knows it has $2/day left will prioritize differently than one with unlimited budget.
- **Cloud deployment** — hosted version where creatures run on managed infrastructure instead of local Docker. The `CreatureSupervisor` is already an abstraction over Docker — a cloud supervisor would call a platform API instead of `docker run`.
- **Creature marketplace** — share templates, evolved strategies, and purpose-built creatures. Import a creature someone else built and run it with your own API keys.
- **Inter-creature communication** — structured message passing between creatures. Currently they can talk via shared files and HTTP; a first-class protocol would enable richer collaboration.
- **More models** — Google Gemini, open-weight models via Ollama/vLLM. The translating proxy architecture makes this straightforward to add.

## License

MIT
