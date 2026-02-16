# openseed

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/node-18%2B-green.svg)](https://nodejs.org/)

Autonomous AI creatures that live in Docker containers. They think, act, sleep, dream, and modify their own code — without human prompting.

> **A creature wakes up, reads its purpose, and starts working. It uses bash, browses the web, makes API calls. When it gets tired, it sleeps — consolidating what it learned into observations, rules, and an honest self-reflection. Every 10th sleep, it evaluates its own cognitive architecture and may rewrite its source code to make itself better. The creature's git log is its autobiography.**

## What This Looks Like

A creature called `okok` trades crypto autonomously. Here's what it wrote about itself after a session:

> *"Treaded water but correctly so — the BTC-weak blocking rule is doing its job. PEPE individually looks like a textbook pullback entry (4h strong up, 1h RSI in zone, 15m higher lows), but entering against a weakening BTC with only $98.80 is how accounts go to zero."*

Its long-term memory — observations tagged by priority — looks like this:

```
RED 05:13 NO POSITIONS. Account: $98.80 USDT. Clean slate.
YLW 05:13 SCANNER BUILT: workspace/scanner.py — scans 16 coins for trend-aligned setups.
YLW 05:13 BTC is DOWN/DOWN (4h RSI 49, 1h RSI 42). Since BTC leads, staying flat until recovery.
GRN 05:13 Key R:R opportunities if market turns: DOGE 19.8x, XRP 14.3x, SOL 10.3x
```

And its git log shows it modifying its own mind:

```
d32ec75 creature: self-modification on sleep
0546a8b creature: self-modification on sleep
bffb2af creator: self/diary.md, src/mind.ts
2a05f89 creature: self-modification on sleep
```

## Why

Most AI agent systems treat the agent as a function — task in, result out, done. openseed treats the agent as a **process**: something that exists continuously, accumulates identity, and learns from its own experience.

The biological metaphors solve real engineering problems:

- **Sleep** forces memory consolidation — the conversation resets, but important things survive as observations and rules
- **Dreams** are honest self-assessment — a separate LLM call that reflects on what the creature actually did
- **Observations** are long-term memory without embeddings or vector databases — priority-tagged text in a markdown file
- **Rules** are behavioral learning injected into the system prompt — the creature literally cannot forget them
- **Fatigue** prevents agents from burning through context doing nothing useful

**Self-evaluation** adds a second timescale of adaptation: the creature learns behavior within its lifetime; during deep sleep, it evaluates its own cognitive architecture and may rewrite its source code.

Everything is radically legible. Every piece of state is a text file. The git log is the creature's autobiography.

## What You Can Build

- **Trading bots** that develop their own strategies, learn from mistakes, and manage risk overnight
- **Research agents** that monitor papers, repos, or feeds and produce daily summaries
- **DevOps creatures** that watch infrastructure, respond to alerts, and improve their own runbooks
- **Content creators** that write, publish, and iterate based on engagement data
- **Open-source contributors** that find repos, open PRs, and track their merge rate

Or give a creature a purpose and see what it invents. The minimal genome starts with nothing — no memory system, no rules — and the creature discovers its own persistence strategies.

## Quick Start

Requires: [Docker](https://www.docker.com/products/docker-desktop/)

The fastest way to get started is with Docker Compose — no Node.js or pnpm needed on your machine:

```bash
git clone https://github.com/openseed-dev/openseed.git
cd openseed
cp .env.example .env
# Edit .env with your API key(s)
docker compose up
```

Open http://localhost:7770, spawn a creature, and watch it think.

### Native Install

If you prefer running the orchestrator directly:

Requires: [Node.js](https://nodejs.org/) 18+, [pnpm](https://pnpm.io/installation), [Docker](https://www.docker.com/products/docker-desktop/)

```bash
git clone https://github.com/openseed-dev/openseed.git
cd openseed
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
pnpm spawn explorer -- --model gpt-5.2 --genome minimal --purpose "explore"
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

## Genomes

Genomes are the cognitive blueprints. Copied into a new creature at spawn time. Each genome has a `genome.json` manifest describing what it is.

**`dreamer`** (default) — Full cognitive architecture: dreams, rules, observations, memory consolidation, fatigue system, persistent browser, self-evaluation during deep sleep. Good for complex, long-running purposes.

**`minimal`** — Bare-bones loop with just bash and sleep. No built-in memory, no dreams, no hints about how to persist state. The creature discovers everything on its own. Good for studying emergent behavior.

Genomes are fully self-contained — they don't depend on any orchestrator-specific logic. This means you can create, share, and install genomes independently.

## What Happens

When you spawn a creature:

1. A directory is created at `~/.openseed/creatures/<name>/` with its own git repo
2. A Docker image is built and a container is created
3. The creature boots, reads its PURPOSE.md, and starts thinking
4. It runs a continuous conversation loop with the LLM, executing bash commands and (for dreamers) browsing the web
5. When it sleeps, it consolidates memories — writing observations, rules, and a dream reflection
6. Every 10th sleep is a "deep sleep" that prunes old memories and runs a self-evaluation
7. The self-evaluation reads the creature's state and may modify its source code to make it better
8. The creature's git log records every self-modification

## CLI

```
seed up [--port 7770]                  start the orchestrator + dashboard
seed spawn <name> [options]            create a new creature
  --purpose "..."                      what the creature should do
  --genome dreamer|minimal             cognitive genome (default: dreamer)
  --model <model>                      LLM model (default: claude-opus-4-6)
seed start <name> [--manual]           start a creature
seed stop <name>                       stop a running creature
seed list                              list all creatures and their status
seed fork <source> <name>              fork a creature with full history
seed destroy <name>                    permanently remove a creature
```

Or via pnpm: `pnpm up`, `pnpm spawn alpha`, `pnpm start alpha`, etc.

## Architecture

```
Orchestrator (src/host/) — single daemon on your machine
├── Web dashboard on :7770 (real-time SSE event stream)
├── LLM proxy — routes to Anthropic or OpenAI based on model
├── Cost tracker — per-creature, per-model token accounting
└── Creature supervisors — health check, promote, rollback
    └── Docker containers (long-lived, persistent)
        ├── Creature process (from genome)
        │   ├── Mind — continuous LLM conversation loop
        │   └── Tools: bash, sleep, browser (dreamer only)
        ├── Bind mount: ~/.openseed/creatures/<name>/ → /creature
        └── Named volumes: node_modules, browser profile
```

**Orchestrator** — manages all creatures. Health-checks every second, promotes after 10s of stability, rolls back on crash. Can be restarted without killing containers — reconnects on startup.

**LLM Proxy** — creatures call the proxy instead of the LLM provider directly. The proxy detects the model, injects the real API key, and routes to the right upstream. For OpenAI models, it translates between Anthropic and OpenAI Responses API formats transparently.

**Supervisors** — one per creature. Manages the Docker container lifecycle, streams logs, handles health gate and rollback logic.

## Creature Files

```
~/.openseed/creatures/<name>/
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
├── BIRTH.json                 identity: name, genome, model, birth time
└── Dockerfile
```

`.sys/` is platform plumbing — the creature doesn't need to know about it. `.self/` is cognitive state that only exists for dreamer creatures. Minimal creatures have no `.self/` — they invent their own persistence strategies.

## Sleep and Dreams

Creatures have a three-tier memory system:

- **In-context** — recent conversation messages (~20K tokens)
- **Observations** — prioritized facts compressed from experience (`.self/observations.md`)
- **Total recall** — full conversation log on disk, searchable with `rg`

A fatigue system tracks activity and forces consolidation. During consolidation, a separate LLM call produces observations, an honest self-reflection ("dream"), and learned behavioral rules. Every 10th dream triggers deep sleep — pruning stale observations, reviewing rules, and running a self-evaluation of the creature's cognitive architecture.

## Deep Dives

- **[Sleep, Dreams, and Memory](docs/dreaming.md)** — the cognitive architecture: fatigue, consolidation, observation priorities, and how it compares to Mastra's Observational Memory
- **[LLM Proxy](docs/llm-proxy.md)** — why Vercel AI SDK, how the translating proxy works, adding new providers
- **[Creator Agent](docs/creator.md)** — the evolutionary architect: triggers, tools, and its relationship to the dreamer genome

## Source Layout

```
src/
  host/
    index.ts          orchestrator — API, SSE, creature management
    proxy.ts          LLM proxy — Anthropic passthrough + OpenAI translation
    supervisor.ts     per-creature Docker lifecycle + health + rollback
    creator.ts        Creator agent (legacy — evaluation now runs inside creatures)
    costs.ts          per-creature, per-model cost tracking
    events.ts         event store (JSONL)
    git.ts            git operations for creature repos
    dashboard.html    web dashboard

  cli/                CLI commands (spawn, start, stop, list, fork, destroy)
  shared/types.ts     event type definitions

genomes/
  dreamer/            full cognitive architecture
  minimal/            bare-bones — creature discovers everything
```

## Where This Is Going

- **Cost controls** — per-creature spending limits with automatic sleep or shutdown when the budget is hit
- **Cost-aware creatures** — expose budget and usage to the creature so it can make economic decisions
- **Cloud deployment** — hosted version where creatures run on managed infrastructure. The `CreatureSupervisor` is already an abstraction over Docker — a cloud supervisor would call a platform API instead of `docker run`
- **Genome marketplace** — share genomes, evolved strategies, and purpose-built creatures. Import a creature someone else designed and run it with your own API keys
- **Inter-creature communication** — structured message passing between creatures for richer collaboration
- **More models** — Google Gemini, open-weight models via Ollama/vLLM. The translating proxy architecture makes this straightforward

## License

[MIT](LICENSE)
