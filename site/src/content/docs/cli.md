---
title: CLI Reference
description: Every command and flag for managing creatures.
order: 5
section: core
---

## Commands

### seed up

Start the orchestrator and dashboard.

```bash
seed up [--port 7770]
```

| Flag | Default | Description |
|---|---|---|
| `--port` | `7770` | Port for the dashboard |

### seed spawn

Create a new creature.

```bash
seed spawn <name> [options]
```

| Flag | Default | Description |
|---|---|---|
| `--purpose "..."` | - | What the creature should do |
| `--genome` | `dreamer` | Cognitive genome (any installed or bundled genome name, GitHub user/repo, or full URL) |
| `--model` | `claude-opus-4-6` | LLM model to use |

### seed start

Start a stopped creature.

```bash
seed start <name> [--manual]
```

Pass `--manual` to start in manual mode. The creature waits for messages instead of thinking autonomously.

### seed stop

Stop a running creature. State is preserved.

```bash
seed stop <name>
```

### seed list

List all creatures and their current status.

```bash
seed list
```

### seed fork

Fork a creature with its full history into a new creature.

```bash
seed fork <source> <name>
```

### seed destroy

Permanently remove a creature and all its data.

```bash
seed destroy <name>
```

### seed genome install

Install a genome from GitHub.

```bash
seed genome install <source>
```

Source can be:
- A name: `dreamer` (expands to `openseed-dev/genome-dreamer`)
- A GitHub path: `someuser/genome-trader`
- A subdirectory path: `someuser/monorepo/genomes/trader` (sparse checkout)
- A full URL: `https://github.com/someuser/cool-mind`

### seed genome search

Search for community genomes on GitHub. Finds repos with the `openseed-genome` topic.

```bash
seed genome search <query>
```

### seed genome list

List all installed and bundled genomes.

```bash
seed genome list
```

### seed genome remove

Remove a user-installed genome.

```bash
seed genome remove <name>
```

### seed genome extract

Extract a genome from a creature's evolved code. Captures the creature's self-modifications as a new, publishable genome with full lineage tracking.

```bash
seed genome extract <creature> --name <genome-name> [--output <dir>]
```

By default, the genome is installed to `~/.openseed/genomes/<name>/` so you can spawn from it immediately. Use `--output` to write to a specific directory for publishing.

## Spending Caps

Every LLM call goes through the orchestrator's proxy, which tracks per-creature daily costs and enforces configurable spending limits.

### Global defaults

Create `~/.openseed/config.json`:

```json
{
  "spending_cap": {
    "daily_usd": 20,
    "action": "sleep"
  }
}
```

### Per-creature overrides

Create `~/.openseed/creatures/<name>/config.json`:

```json
{
  "spending_cap": {
    "daily_usd": 50
  }
}
```

Per-creature values override global defaults. Missing fields fall back to global, then to the hardcoded default ($20/day, action: sleep).

### Actions

| Action | Behavior |
|---|---|
| `sleep` (default) | Creature is paused when daily cap is hit. Container stopped, files preserved. Auto-wakes at UTC midnight. |
| `warn` | Logs a warning but allows the call through. Monitoring-only mode. |
| `off` | No enforcement for this creature. |

### Budget API

The orchestrator exposes budget info per creature:

```
GET /api/creatures/<name>/budget
```

Returns:

```json
{
  "daily_cap_usd": 20,
  "daily_spent_usd": 12.50,
  "remaining_usd": 7.50,
  "resets_at": "2026-02-17T00:00:00.000Z",
  "action": "sleep",
  "status": "ok"
}
```

## pnpm Equivalents

If running natively (not via Docker), use `pnpm run` to invoke the same commands:

| seed | pnpm |
|---|---|
| `seed up` | `pnpm run up` |
| `seed spawn alpha --purpose "..."` | `pnpm run spawn -- alpha --purpose "..."` |
| `seed start alpha` | `pnpm run start -- alpha` |
| `seed stop alpha` | `pnpm run stop -- alpha` |
| `seed list` | `pnpm run list` |
| `seed fork alpha beta` | `pnpm run fork -- alpha beta` |
| `seed destroy alpha` | `pnpm run destroy -- alpha` |

Use `pnpm run` (not bare `pnpm`) because `pnpm up` and `pnpm list` are built-in pnpm commands that do something else entirely. The `--` separator passes arguments through to the underlying script.
