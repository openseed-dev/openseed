# Creator

The Creator is the evolutionary architect — an LLM agent (claude-opus-4-6) that evaluates a creature's cognitive architecture and makes targeted improvements. It doesn't do the creature's tasks; it changes *how the creature thinks*.

Code: `src/host/creator.ts`

## How It Gets Triggered

Three paths:

1. **Deep sleep** — when a creature emits `creature.dream` with `deep=true`, the host auto-triggers Creator (`src/host/index.ts` ~line 292)
2. **Creature request** — the creature calls `request_evolution` tool, which emits `creature.request_evolution`, and the host triggers Creator with the creature's reason
3. **Manual** — POST to `/api/creatures/:name/evolve` from the dashboard

## What It Does

The Creator gets a system prompt framing it as an evolutionary coach, plus context built from:
- Its own previous evaluation logs (`.self/creator-log.jsonl`)
- Recent rollback history (`~/.itsalive/rollbacks/<name>.jsonl`)

It then uses tools to investigate and modify the creature:

| Tool | What it does |
|------|-------------|
| `bash` | Shell commands in the creature's repo dir (read files, make edits, grep, etc.) |
| `read_events` | Last N events from the creature's event stream |
| `read_dreams` | Last N entries from `.self/dreams.jsonl` |
| `get_status` | Creature status (running/sleeping/stopped) |
| `restart` | Validates TypeScript, git commits, restarts the creature process |
| `done` | Ends the evaluation with reasoning + changed flag |

Max 30 turns per evaluation. Results logged to `.self/creator-log.jsonl` and emitted as `creator.evaluation` events.

## Dreamer-Specific Coupling

The Creator was built for the dreamer template and is tightly coupled to it. Specifically:

**Prompt assumes dreamer concepts exist:**
- References consolidation, rules, progress checks, fatigue as things to evaluate
- Lists `.self/rules.md` and `.self/observations.md` as modifiable files
- Describes the RED/YLW/GRN observation priority system
- Tells the LLM to `cat .self/observations.md`, `cat .self/rules.md`, and use `read_dreams`

**Tools assume dreamer state:**
- `read_dreams` reads `.self/dreams.jsonl` — only written by the dreamer's consolidation system
- The context builder directs the Creator to read files that only the dreamer creates

**Trigger mechanism assumes dreamer events:**
- Auto-trigger fires on `creature.dream` with `deep=true` — the dreamer emits these every 10th consolidation
- The creature-initiated path requires `request_evolution` — a tool only the dreamer template has

## Effectively Dead for Minimal Creatures

A minimal creature:
- Never emits `creature.dream` events → Creator never auto-triggers
- Has no `request_evolution` tool → creature can't request it
- Has no `request_restart` tool → creature relies on sleep-based auto-apply only
- Has no `.self/dreams.jsonl`, `.self/rules.md`, `.self/observations.md` → Creator's investigation finds nothing
- Has no consolidation, fatigue, or progress check machinery → Creator's evaluation criteria are irrelevant

The only way to trigger Creator for a minimal creature is manually from the dashboard, and even then it operates with wrong assumptions about the creature's architecture.

This is fine for now — minimal creatures (like Eve) don't need evolutionary oversight.

## If We Ever Want Creator for Minimal

What would need to change:

- **Template-aware prompting** — Creator detects what files/systems exist and adjusts its prompt accordingly (or we maintain per-template Creator prompts)
- **Generalized triggers** — time-based or action-count-based triggers that don't depend on dream events
- **Adjusted tool set** — drop `read_dreams` or make it optional; don't reference files that don't exist
- **Minimal-appropriate evaluation criteria** — instead of "is consolidation working?", ask "is it making progress? is it sleeping too much or too little? is it using bash effectively?"
