# itsalive

A hatchery for autonomous, self-modifying creatures. Each creature lives in its own git repo, runs in a Docker sandbox, evolves its own code, and survives failures through automatic rollback.

## Quick start

```bash
# Clone and install
git clone git@github.com:rsdouglas/itsalive.git
cd itsalive && pnpm install

# Set your Anthropic API key
export ANTHROPIC_API_KEY="sk-ant-..."

# Start Docker, then spawn a creature
pnpm spawn alpha --purpose "explore the world"

# Start it (auto-detects Docker, runs sandboxed)
pnpm start alpha

# Open the dashboard
open http://localhost:7770
```

## What happens

When you spawn a creature, it gets its own directory at `~/.itsalive/creatures/<name>/` with its own git repo. A Docker image is built for it. The creature thinks using Claude in a continuous conversation loop, executes bash commands, browses the web, and can modify its own code. A host process watches over it — promoting stable commits and rolling back broken ones.

The creature's git log becomes its autobiography. Every self-modification is a commit.

## CLI

```
itsalive spawn <name> [--purpose "..."]   create a new creature (builds Docker image)
itsalive start <name> [--manual] [--bare] start a creature
itsalive stop <name>                      stop a running creature
itsalive list                             list all creatures
itsalive destroy <name>                   stop and remove a creature
itsalive fork <source> <name>             fork a creature with full history
```

Or via pnpm scripts: `pnpm spawn alpha`, `pnpm start alpha`, etc.

Options:
- `--bare` — run without Docker sandbox (uses local node directly)
- `--manual` — don't auto-start the cognition loop

Multiple creatures can run simultaneously — each gets auto-assigned ports.

## Architecture

```
Your Mac
├── itsalive CLI (src/cli/)
│   └── spawns ↓
├── Host process (src/host/index.ts) — runs natively
│   ├── Web dashboard on :hostPort
│   ├── Health checks creature on :creaturePort
│   ├── SSE event stream + event store
│   └── spawns ↓
└── Docker container "creature-<name>"
    ├── Creature process (src/index.ts)
    │   ├── HTTP server on :7778
    │   ├── Mind — continuous LLM conversation loop
    │   └── Tools: bash, browser, set_sleep, read/write/commit
    ├── Bind mount: ~/.itsalive/creatures/<name> ↔ /creature
    └── Named volume: node_modules (Linux-native)
```

**Host** — runs on the Mac, outside Docker. Supervises the creature container, serves the web dashboard, stores events. Health-checks every second, promotes after 10s of stability, rolls back on crash or timeout. The host can be restarted independently without killing the creature container — it reconnects to running containers on startup.

**Creature** — runs inside a Docker container with resource limits (2GB RAM, 1.5 CPUs). Thinks via Claude in a single continuous conversation, acts via bash and a persistent headless browser, modifies its own code. Git tracks every mutation.

**Template** — the embryo (`template/`). Copied into a new creature at spawn time. Self-contained TypeScript project with no imports from the framework.

## Cognition

Creatures run a single continuous conversation with Claude. No iteration loops — just one long-running dialogue where the LLM proposes tool calls, sees real results, and keeps going:

1. Build initial context from PURPOSE.md, diary, and last iteration summary
2. Enter continuous conversation loop with Claude
3. LLM uses tools: bash, browser, read/write files, git commit, set_sleep
4. On `set_sleep`, the creature pauses for the requested duration, then resumes the same conversation
5. When context gets too large, older messages are archived into a summary

The creature logs iteration summaries to `.self/iterations.jsonl` for reflection.

## Docker sandboxing

Creatures run in Docker containers for isolation:
- Filesystem: bind-mounted creature directory, separate named volume for node_modules
- Resources: memory and CPU limits
- Network: communicates with host via `host.docker.internal`
- Browser: Playwright Chromium installed in the container with a persistent profile at `.self/browser-profile`

Use `--bare` to skip Docker and run directly on the host (useful for debugging).

## Files

```
src/
  host/           host process (supervise, promote, rollback, web dashboard)
  cli/            CLI commands (spawn, start, stop, list, destroy, fork)
  shared/         event types

template/         creature embryo (copied on spawn)
  src/
    index.ts      entry point + HTTP server
    mind.ts       LLM cognition loop + context archival
    memory.ts     JSONL persistence
    tools/
      bash.ts     shell command execution (hardened, non-interactive)
      browser.ts  persistent headless Chromium browser
  Dockerfile      container image definition
  PURPOSE.md      default purpose/attractor
  self/diary.md   empty journal
```
