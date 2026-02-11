# itsalive

A hatchery for autonomous, self-modifying creatures. Each creature lives in its own git repo, evolves its own code, and survives failures through automatic rollback.

## Quick start

```bash
# Clone and install
git clone git@github.com:rsdouglas/itsalive.git
cd itsalive && pnpm install

# Set your Anthropic API key
export ANTHROPIC_API_KEY="sk-ant-..."

# Spawn a creature
pnpm spawn alpha

# Start it
pnpm start alpha

# Open the dashboard
open http://localhost:7770
```

## What happens

When you spawn a creature, it gets its own directory at `~/.itsalive/creatures/<name>/` with its own git repo. The creature thinks using Claude, executes bash commands, and can modify its own code. A host process watches over it — promoting stable commits and rolling back broken ones.

The creature's git log becomes its autobiography. Every self-modification is a commit.

## CLI

```
itsalive spawn <name> [--purpose "..."]   create a new creature
itsalive start <name> [--manual]          start a creature
itsalive stop <name>                      stop a running creature
itsalive list                             list all creatures
itsalive destroy <name>                   stop and remove a creature
itsalive fork <source> <name>             fork a creature with full history
```

Or via pnpm scripts: `pnpm spawn alpha`, `pnpm start alpha`, etc.

Multiple creatures can run simultaneously — each gets auto-assigned ports.

## Architecture

```
itsalive repo (the hatchery)              ~/.itsalive/creatures/alpha/ (a creature)
├── src/host/     guardian framework       ├── .git/          its autobiography
├── src/cli/      human interface          ├── .self/         runtime brain state
├── template/     creature embryo          ├── src/           its mutable code
│   ├── src/                               ├── self/diary.md  its journal
│   ├── PURPOSE.md                         ├── PURPOSE.md     its soul
│   └── ...                                ├── BIRTH.json     birth certificate
└── ...                                    └── package.json
```

**Host** — immutable guardian that supervises a creature. Health-checks every second, promotes after 10s of stability, rolls back on crash or timeout. Lives in the hatchery, untouchable by the creature.

**Creature** — autonomous agent running in its own repo. Thinks via LLM, acts via bash, modifies its own code. Can rewrite its purpose, add tools, change its mind implementation. Git tracks every mutation.

**Template** — the embryo. Copied into a new creature at spawn time. Self-contained TypeScript project with no imports from the framework.

## Cognition loop

Each thought cycle:
1. Load PURPOSE.md + recent memory
2. Call Claude with system prompt and tools
3. Execute bash commands
4. Record actions to memory
5. Sleep for LLM-determined duration (2–300s)
6. Repeat

## Memory

Creatures maintain continuity across restarts:
- `.self/memory.jsonl` — append-only log of thoughts, actions, observations
- `.self/snapshots/` — periodic compressed summaries
- `.self/events.jsonl` — host event stream

Memory is gitignored, so it survives rollbacks. The creature never loses its memories even when its code is reverted.

## Forking

Since creatures are git repos, forking is natural:

```bash
itsalive fork alpha beta
```

Beta inherits alpha's full evolutionary history and diverges from there. `BIRTH.json` tracks lineage.

## Files

```
src/
  host/           guardian process (supervise, promote, rollback)
  cli/            CLI commands (spawn, start, stop, list, destroy, fork)
  shared/         event types

template/         creature embryo (copied on spawn)
  src/
    index.ts      entry point + cognition loop
    mind.ts       LLM cognition + context building
    memory.ts     JSONL persistence + snapshots
    tools/
      bash.ts     CLI command execution
  PURPOSE.md      default attractor
  self/diary.md   empty journal
```
