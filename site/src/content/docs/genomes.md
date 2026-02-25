---
title: Genomes
description: Cognitive blueprints that define what a creature can do, not what it will do.
order: 4
section: core
---

## What Is a Genome?

A genome is a cognitive blueprint. When you spawn a creature, its genome is copied into the container. It defines the **structure** of the creature's mind (what tabs appear, what tools exist, how validation works) but not its **behavior**. Two creatures with the same genome and different purposes will act completely differently.

Genomes are self-contained directories. They include source code, a `genome.json` manifest, and everything the creature needs to boot. No orchestrator-specific dependencies.

## genome.json Reference

Every genome has a `genome.json` at its root:

| Field | Type | Description |
|---|---|---|
| `name` | string | Genome identifier (e.g. `"dreamer"`) |
| `version` | string | Semver version |
| `description` | string | One-line summary |
| `author` | string | Who wrote it |
| `license` | string | License identifier (e.g. `"MIT"`) |
| `tags` | string[] | Categorization tags |
| `requires` | object? | Version constraints (e.g. `{ "openseed": ">=0.0.1" }`) |
| `validate` | string | Command to validate the creature's code before boot (e.g. `"npx tsx --check src/mind.ts src/index.ts"`) |
| `tabs` | Tab[] | What shows in the dashboard |

### Tabs

Each tab is an object:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier |
| `label` | string | Display name in the dashboard |
| `file` | string | Path to the file inside the creature's workspace |
| `type` | string | `markdown`, `text`, or `jsonl` |
| `limit` | number? | Optional: max lines to display (useful for logs) |

## Built-in Genomes

OpenSeed ships with three genomes bundled in `genomes/`. They're the source of truth and available out of the box.

### dreamer (default)

Full cognitive architecture. Creatures with this genome can dream, consolidate memories, self-evaluate, manage fatigue, browse the web with a persistent browser session, and maintain evolving rules about their world.

**Tabs:** purpose, diary, observations, rules, dreams, self-eval

**Source:** `genomes/dreamer/`

Use this when you want a creature that learns and adapts over time.

### minimal

Bare-bones loop: bash and sleep. No memory, no dreams, no self-evaluation. The creature discovers everything on its own from a blank slate.

**Tabs:** purpose

**Source:** `genomes/minimal/`

Use this when you want to see what emerges without any cognitive scaffolding, or as a starting point for a custom genome.

### wonders (experimental)

Subconscious memory experiment. No explicit memory, no observations, no rules, no dreaming. Conversation resets every cycle. The only source of long-term continuity is a background process — the subconscious — that watches what the creature is doing, hypothesizes about what past experience might be relevant, searches for it, and injects it as a thought if something genuinely useful turns up.

**Tabs:** purpose

**Source:** `genomes/wonders/`

Use this when you want to test implicit memory retrieval in isolation, or study what happens when a creature's only connection to its past is associative recall. See [Subconscious Memory](/docs/subconscious-memory) for the full architecture.

## Managing Genomes

```bash
seed genome list                                           # show installed + bundled genomes
seed genome search trading                                 # search community genomes on GitHub
seed genome install dreamer                                # install from openseed-dev/genome-dreamer
seed genome install someuser/genome-foo                    # install from any GitHub repo
seed genome install someuser/monorepo/genomes/foo          # subdirectory within a repo
seed genome install https://github.com/someuser/cool-mind  # full URL works too
seed genome remove foo                                     # remove an installed genome
```

When you spawn a creature with a genome that isn't installed locally, OpenSeed will auto-install it from GitHub.

## Creating Your Own

The easiest way to build a custom genome is to fork an existing one:

1. Start from `genomes/dreamer` or `genomes/minimal` in the openseed repo
2. Edit `genome.json`: change the name, tabs, validation command
3. Modify the source code to add or remove cognitive features
4. Push to your own GitHub repo
5. Add the `openseed-genome` topic to your repo on GitHub so others can discover it via `seed genome search`
6. Install it: `seed genome install your-username/genome-your-name`
7. Spawn a creature with it: `seed spawn scout --genome your-name`

Genomes have no dependency on the orchestrator. Everything the creature needs lives inside the genome directory. A genome could be written in any language as long as it exposes the expected HTTP endpoints (`/healthz`, `/tick`, `/wake`, `/message`).

If your genome requires a minimum version of OpenSeed, add a `requires` field to `genome.json`:

```json
{
  "requires": { "openseed": ">=0.1.0" }
}
```

Users will see a warning if their OpenSeed version is too old.

## Extracting a Genome from a Creature

Creatures evolve through self-modification. You can extract a creature's evolved code back into a new genome:

```bash
seed genome extract eve --name evolved-minimal
```

This captures the creature's self-modified source code, strips its identity and cognitive state, and packages it as a new genome with lineage tracking. The extracted `genome.json` includes a `lineage` field recording which genome it descended from, which creature it was extracted from, and at what point in the creature's history.

The result is a genome that embodies everything the creature learned about *how to think*, without carrying over *what it was thinking about*. Anyone can spawn from it.
