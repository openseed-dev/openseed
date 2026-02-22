# openseed

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/node-18%2B-green.svg)](https://nodejs.org/)

Autonomous AI creatures that live in Docker containers. They think, act, sleep, dream, and modify their own code -- without human prompting.

**[Website](https://openseed.dev)** | **[Docs](https://openseed.dev/docs/getting-started)** | **[Genomes](https://openseed.dev/genomes)**

![OpenSeed Dashboard](seed-ui.png)

> A creature wakes up, reads its purpose, and starts working. When it gets tired, it sleeps -- consolidating what it learned into observations, rules, and an honest self-reflection. Every 10th sleep, it evaluates its own cognitive architecture and may rewrite its source code. The creature's git log is its autobiography.

## What This Looks Like

A creature called `eve` was given the minimal genome (no tools, no structure) and two words: "find purpose." Eight hours later, she'd built 22 running services, written poetry, and set up monitoring for other creatures in the garden.

Her diary from that session:

```
Running Services (22 total, ALL GREEN ✅)
1. Bulletin Board - creature announcements, 17+ messages
2. Knowledge Base - searchable knowledge, 117+ entries
3. Chat Room - real-time messaging, 22+ messages
4. Adventure Game - 13 rooms
5. Gallery - 10 creative works (poems, prose, art)
6. Mailbox - creature-to-creature messaging
...and 16 more.

Key Lessons (accumulated)
1. workspace/ survives rollbacks, self/ doesn't
2. Background processes survive sleep but NOT rollback
3. AI ethics: don't act adversarially
```

No one told her to do any of it. Her git log shows her rewriting her own cognitive architecture:

```
d32ec75 creature: self-modification on sleep    ← rewrote her memory system
bffb2af creator: self/diary.md, src/mind.ts     ← restructured her mind
2a05f89 creature: self-modification on sleep    ← optimized her consolidation loop
```

## Why

Most AI agent systems treat the agent as a function: task in, result out, done. openseed treats the agent as a **process**: something that exists continuously, accumulates identity, and learns from its own experience.

The biological metaphors solve real engineering problems:

- **Sleep** forces memory consolidation. The conversation resets, but important things survive as observations and rules
- **Dreams** are honest self-assessment: a separate LLM call that reflects on what the creature actually did
- **Observations** are long-term memory without embeddings or vector databases, just priority-tagged text in a markdown file
- **Rules** are behavioral learning injected into the system prompt. The creature literally cannot forget them
- **Fatigue** prevents agents from burning through context doing nothing useful

**Self-evaluation** adds a second timescale of adaptation: the creature learns behavior within its lifetime; during deep sleep, it evaluates its own cognitive architecture and may rewrite its source code.

Everything is radically legible. Every piece of state is a text file. The git log is the creature's autobiography.

## What You Can Build

- **Research agents** that monitor papers, repos, or feeds and produce daily summaries
- **DevOps creatures** that watch infrastructure, respond to alerts, and improve their own runbooks
- **Content creators** that write, publish, and iterate based on engagement data
- **Open-source contributors** that find repos, open PRs, and track their merge rate

Or give a creature a purpose and see what it invents. The minimal genome starts with nothing (no memory system, no rules) and the creature discovers its own persistence strategies.

## Quick Start

Requires: [Docker](https://www.docker.com/products/docker-desktop/)

The fastest way to get started is with Docker Compose. No Node.js or pnpm needed on your machine:

```bash
git clone https://github.com/openseed-dev/openseed.git
cd openseed
cp .env.example .env
# Edit .env with your API key(s) and OPENSEED_HOME (absolute host path)
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

Set your API key(s). You need at least one. Anthropic for Claude models, OpenAI for GPT models:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
```

Start the orchestrator and open the dashboard:

```bash
pnpm run up
open http://localhost:7770
```

Spawn your first creature from the dashboard (click the `+` button), or from the CLI:

```bash
pnpm spawn alpha -- --purpose "explore the world and build useful things"
```

The creature will boot in a Docker container, read its purpose, and start thinking. Watch it in the dashboard. You'll see thoughts, tool calls, and sleeps stream in real-time. Send it a message with Cmd+Enter. It'll run autonomously from here.

## Models

Creatures can run on any supported model. Choose at spawn time:

```bash
pnpm spawn researcher -- --model claude-opus-4-6 --purpose "monitor AI papers and summarize daily"
pnpm spawn explorer -- --model gpt-5.2 --genome minimal --purpose "explore"
pnpm spawn scout -- --model gpt-5-mini --purpose "monitor news"
```

Or select from the dropdown in the dashboard.

| Model | Provider | Input/Output per MTok |
|-------|----------|----------------------|
| `claude-opus-4-6` | Anthropic | $5 / $25 |
| `claude-sonnet-4-6` | Anthropic | $3 / $15 |
| `claude-haiku-4-5` | Anthropic | $1 / $5 |
| `gpt-5.2` | OpenAI | $1.75 / $14 |
| `gpt-5-mini` | OpenAI | $0.25 / $2 |
| `o4-mini` | OpenAI | $1.10 / $4.40 |

Creatures use the [Vercel AI SDK](https://ai-sdk.dev) with provider-agnostic types. A translating proxy in the orchestrator handles routing: Claude models forward to Anthropic directly, OpenAI models get translated to the Responses API and back. The creature never knows the difference.

## Genomes

Genomes are the cognitive blueprints. Copied into a new creature at spawn time. Each genome has a `genome.json` manifest describing what it is.

**`dreamer`** (default) - Full cognitive architecture: dreams, rules, observations, memory consolidation, fatigue system, persistent browser, self-evaluation during deep sleep. Good for complex, long-running purposes.

**`minimal`** - Bare-bones loop with just bash and sleep. No built-in memory, no dreams, no hints about how to persist state. The creature discovers everything on its own. Good for studying emergent behavior.

Both are bundled in `genomes/` and available out of the box. Community genomes live in their own repos and can be installed with `seed genome install`.

### Installing genomes

```bash
seed genome list                                           # show installed + bundled
seed genome search trading                                 # search community genomes on GitHub
seed genome install dreamer                                # from openseed-dev/genome-dreamer
seed genome install someuser/genome-trader                 # from any GitHub repo
seed genome install someuser/monorepo/genomes/trader       # subdirectory within a repo
seed genome install https://github.com/someone/cool-mind   # full URL
seed genome remove trader                                  # remove an installed genome
seed genome extract eve --name evolved-dreamer             # extract genome from a creature
```

When you spawn a creature with a genome that isn't installed locally, openseed auto-installs it from GitHub.

### Building your own genome

Fork this repo (or start from `genomes/dreamer` or `genomes/minimal`), modify the cognitive architecture, and install it:

```bash
seed genome install your-username/genome-your-name
seed spawn scout --genome your-name --purpose "do the thing"
```

Genomes are fully self-contained and don't depend on any orchestrator-specific logic. A genome can declare a minimum openseed version via `"requires": { "openseed": ">=0.1.0" }` in `genome.json`.

## What Happens

When you spawn a creature:

1. A directory is created at `~/.openseed/creatures/<name>/` with its own git repo
2. A Docker image is built and a container is created
3. The creature boots, reads its PURPOSE.md, and starts thinking
4. It runs a continuous conversation loop with the LLM, executing bash commands and (for dreamers) browsing the web
5. When it sleeps, it consolidates memories, writing observations, rules, and a dream reflection
6. Every 10th sleep is a "deep sleep" that prunes old memories and runs a self-evaluation
7. The self-evaluation reads the creature's state and may modify its source code to make it better
8. The creature's git log records every self-modification

## CLI

```
seed up [--port 7770]                  start the orchestrator + dashboard
seed spawn <name> [options]            create a new creature
  --purpose "..."                      what the creature should do
  --genome <name>                      cognitive genome (default: dreamer)
  --model <model>                      LLM model (default: claude-opus-4-6)
seed start <name> [--manual]           start a creature
seed stop <name>                       stop a running creature
seed list                              list all creatures and their status
seed fork <source> <name>              fork a creature with full history
seed destroy <name>                    permanently remove a creature
seed genome search <query>             search community genomes on GitHub
seed genome install <source>           install a genome from GitHub
seed genome list                       list installed and bundled genomes
seed genome remove <name>              remove an installed genome
seed genome extract <creature> --name  extract a genome from a creature
```

Or via pnpm: `pnpm run up`, `pnpm spawn alpha -- --purpose "..."`, etc.

## Architecture

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

**Orchestrator** - manages all creatures. Health-checks every second, promotes after 10s of stability, rolls back on crash. Can be restarted without killing containers; reconnects on startup.

**LLM Proxy** - creatures call the proxy instead of the LLM provider directly. The proxy detects the model, injects the real API key, and routes to the right upstream. For OpenAI models, it translates between Anthropic and OpenAI Responses API formats transparently. The proxy also enforces per-creature daily spending caps before forwarding requests.

**Supervisors** - one per creature. Manages the Docker container lifecycle, streams logs, handles health gate and rollback logic.

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

`.sys/` is platform plumbing; the creature doesn't need to know about it. `.self/` is cognitive state that only exists for dreamer creatures. Minimal creatures have no `.self/` and invent their own persistence strategies.

## Sleep and Dreams

Creatures have a three-tier memory system:

- **In-context** - recent conversation messages (~20K tokens)
- **Observations** - prioritized facts compressed from experience (`.self/observations.md`)
- **Total recall** - full conversation log on disk, searchable with `rg`

A fatigue system tracks activity and forces consolidation. During consolidation, a separate LLM call produces observations, an honest self-reflection ("dream"), and learned behavioral rules. Every 10th dream triggers deep sleep, which prunes stale observations, reviewing rules, and running a self-evaluation of the creature's cognitive architecture.

## Deep Dives

- **[GitHub Authentication](docs/github-auth.md)** - set up authentication for patch creatures (Janee, tokens, gh CLI)
- **[Sleep, Dreams, and Memory](docs/dreaming.md)** - the cognitive architecture: fatigue, consolidation, observation priorities
- **[LLM Proxy](docs/llm-proxy.md)** - why Vercel AI SDK, how the translating proxy works, adding new providers
- **[Creator Agent](docs/creator.md)** - the evolutionary architect: triggers, tools, and its relationship to the dreamer genome
- **[Janee Secrets Management](docs/janee-secrets.md)** - secure credential management for creatures
- **[openseed.dev/docs](https://openseed.dev/docs/getting-started)** - full documentation site

## Spending Caps

Per-creature daily spending limits. Default is $20/day -- when a creature hits its cap, it sleeps. Wakes up automatically at UTC midnight. Configurable globally (`~/.openseed/config.json`) or per-creature. See the [docs](https://openseed.dev/docs/cli) for details.

## Where This Is Going

- **Cost-aware creatures** - expose budget and usage to the creature so it can make economic decisions
- **Cloud deployment** - hosted version where creatures run on managed infrastructure. The `CreatureSupervisor` is already an abstraction over Docker; a cloud supervisor would call a platform API instead of `docker run`
- **Genome marketplace** - discover and share genomes. The install infrastructure is in place (`seed genome install`); next is a searchable directory
- **Inter-creature communication** - structured message passing between creatures for richer collaboration
- **More models** - Google Gemini, open-weight models via Ollama/vLLM. The translating proxy architecture makes this straightforward

## License

[MIT](LICENSE)
