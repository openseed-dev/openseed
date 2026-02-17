# Contributing to OpenSeed

Thanks for your interest. This guide covers how to get set up and contribute.

## Dev Setup

```bash
git clone https://github.com/openseed-dev/openseed.git
cd openseed
pnpm install
```

You need at least one LLM API key:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
# and/or
export OPENAI_API_KEY="sk-..."
```

Start the orchestrator:

```bash
pnpm up
```

Dashboard at http://localhost:7770.

## Architecture Overview

```
src/host/          orchestrator, the single daemon that manages everything
  index.ts         API server, SSE event stream, creature management
  supervisor.ts    per-creature Docker lifecycle, health gating, rollback
  proxy.ts         LLM proxy: routes to Anthropic or OpenAI, translates formats
  creator.ts       Creator agent: evaluates and evolves creature source code
  costs.ts         per-creature cost tracking
  events.ts        event store (JSONL)
  dashboard.html   web dashboard

src/cli/           CLI commands (spawn, start, stop, list, fork, destroy)
src/shared/        shared types (event definitions)

genomes/
  dreamer/         full cognitive genome: dreams, rules, observations, fatigue
  minimal/         bare-bones genome: creature discovers everything itself
```

Creatures run in Docker containers. The orchestrator creates and manages the containers via `docker` CLI commands. Creatures communicate back to the orchestrator via HTTP POST (events) and GET (LLM proxy).

## Making Changes

### Orchestrator

Edit files in `src/host/`. The orchestrator runs via `tsx`. Restart it to pick up changes.

### Genomes

Edit files in `genomes/dreamer/` or `genomes/minimal/`. Genome changes only affect newly spawned creatures. Existing creatures have their own copy of the genome code at `~/.openseed/creatures/<name>/src/`.

### Live Creatures

You can edit a creature's code directly at `~/.openseed/creatures/<name>/src/`. The creature process restarts on code changes (it rebuilds on boot). This is useful for testing changes against a creature with real state.

## Pull Requests

- One feature or fix per PR
- Keep PRs small: easier to review, easier to revert
- Describe what changed and why in the PR description
- If you're adding a new event type, update `src/shared/types.ts`
- If you're changing the dashboard, include a screenshot

## Code Style

- TypeScript, ESM modules
- No semicolons (the codebase is inconsistent about this, so follow the file you're editing)
- Minimal comments: explain *why*, not *what*
- No full JSDoc. Keep type annotations on the signature, skip `@param`/`@returns`

## Testing

There's no test suite yet. If you're adding one, we'd welcome it. For now, test manually:

1. Start the orchestrator (`pnpm up`)
2. Spawn a test creature (`pnpm spawn test-creature`)
3. Verify your change in the dashboard and creature logs

## Creature Data

Creature data lives at `~/.openseed/` (configurable via `OPENSEED_HOME`). Each creature has its own git repo. Creatures validate and commit their own code changes before sleeping.

## Questions

Open an issue or start a discussion. We're friendly.
