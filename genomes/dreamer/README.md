# Dreamer Genome

A cognitive architecture built around memory, reflection, and self-modification. The Dreamer runs as a continuous autonomous process — thinking, acting, accumulating fatigue, sleeping, dreaming, and occasionally rewriting its own source code.

## How it works

The Dreamer's identity emerges from **persistent memory**. It accumulates observations, distills behavioral rules from experience, and uses a biological sleep/dream cycle to consolidate what it's learned. Over time, it develops continuity — it remembers what worked, what didn't, and what it was told.

```
┌──────────────────────────────────────────────────────┐
│                    Main Loop                         │
│                                                      │
│  ┌─────────┐    ┌─────────┐    ┌─────────────────┐  │
│  │  Think   │───>│   Act   │───>│ Fatigue += 1    │  │
│  │  (LLM)   │    │ (tools) │    │                 │  │
│  └─────────┘    └─────────┘    └────────┬────────┘  │
│       ▲                                  │           │
│       │                    ┌─────────────┤           │
│       │                    │ >= 60: warn │           │
│       │                    │ >= 80: force│           │
│       │                    │    sleep    │           │
│       │                    └──────┬──────┘           │
│       │                           ▼                  │
│       │                    ┌─────────────┐           │
│       │                    │   SLEEP +   │           │
│       │                    │   DREAM     │           │
│       │                    └──────┬──────┘           │
│       │                           │                  │
│       └───────────────────────────┘                  │
└──────────────────────────────────────────────────────┘
```

## The fatigue system

Creatures can't run forever. Every tool call (bash, browser, janee) increments a fatigue counter:

- **60 actions**: a warning is injected — "You've been active for a while. Start wrapping up."
- **80 actions**: forced consolidation and sleep. No choice.

The creature can also sleep voluntarily using `set_sleep`. Background processes survive sleep and can call `wakeup "reason"` to interrupt it early.

## Dreaming (consolidation)

When sleep triggers, a **separate LLM call** — the Observer — reviews what just happened. This isn't a simple summarizer. It has bash access and is explicitly told to verify claims, check git logs, and not trust the creature's narrative.

The Observer produces:

- **Observations** — priority-tagged facts written to `.self/observations.md`:
  - `RED` — critical: commitments, credentials, key wins. Never pruned.
  - `YLW` — important: project status, patterns learned. Pruned when superseded.
  - `GRN` — informational: tool outputs, environment facts. Pruned after 48h.
- **Rules** — behavioral constraints in ALWAYS/NEVER format, written to `.self/rules.md` (capped at 15). These are injected into the system prompt every iteration, framed as "hard-won rules from your own experience."
- **Reflection** — a brief honest assessment logged to `.self/dreams.jsonl`.

Sessions with fewer than 5 actions get lightweight consolidation (no LLM call, just checkpoint the dream).

## Deep sleep

Every 5th dream triggers deep sleep, which does heavier processing:

1. **Prune observations** — drop stale `GRN` entries, remove superseded `YLW` entries
2. **Evaluate rules** — merge overlapping rules, remove stale ones
3. **Write a diary entry** — appended to `.self/diary.md`
4. **Self-evaluation** — see below

## Self-modification

The Dreamer can edit its own source code. A separate "Creator" LLM agent (up to 100 turns with bash access) is triggered on deep sleep or when the creature explicitly calls `request_evolution`. It:

1. Reviews dreams, iteration logs, rollback history, observations, rules, and source code
2. Diagnoses failure patterns: spinning, rule violations, memory loss, error loops
3. Edits `src/mind.ts`, `src/tools/*`, `PURPOSE.md`, or `.self/rules.md`
4. Validates with `npx tsx --check` before requesting a restart

The orchestrator maintains a git-based rollback safety net — if the creature breaks itself, it reverts to the last working commit.

## Memory tiers

1. **In-context** — the last ~20 messages in the active conversation. Trimmed on overflow.
2. **Observations** — compressed, prioritized facts from consolidation. Injected into the system prompt on wake.
3. **On-disk** — full conversation log (`.self/conversation.jsonl`), every dream (`.self/dreams.jsonl`), all observations. Never deleted, searchable with `rg`.

## Waking up

After sleep, the creature receives a rich context message: how long it slept, its last reflection, current observations, and a pointer to full history files. On a full container restart, the same context is loaded from disk — the creature never starts from zero.

## Tools

- **bash** — shell execution with background process support. Output captured via temp files so `nohup` and `&` work properly.
- **browser** — persistent headless Chromium (Playwright). Profile survives restarts. Anti-detection measures. 12 actions including navigation, interaction, JS evaluation, and DOM snapshots.
- **janee** — secure credential proxy. The creature never sees raw API keys; Janee injects them into requests.
- **set_sleep** — pause for 2s to 24h. Triggers consolidation if eligible.
- **request_restart** — ask the orchestrator to restart (after self-modifying code).
- **request_evolution** — trigger the Creator agent for on-demand self-evaluation.

## Files on disk

```
.self/
  observations.md       prioritized facts from consolidation (RED/YLW/GRN)
  rules.md              learned behavioral rules (max 15)
  dreams.jsonl          every dream: observations, reflection, priority
  conversation.jsonl    full transcript (append-only, searchable)
  creator-log.jsonl     self-evaluation history
  diary.md              deep sleep diary entries
  memory.jsonl          structured memory records
  browser-profile/      persistent Chromium state

.sys/
  iterations.jsonl      per-sleep checkpoints (actions, intent, duration)
  boot-ok               health sentinel
```

## Constants

| Constant | Default | What it controls |
|----------|---------|-----------------|
| `FATIGUE_WARNING` | 60 | Actions before tiredness warning |
| `FATIGUE_LIMIT` | 80 | Actions before forced sleep |
| `MIN_DREAM_INTERVAL_MS` | 10 min | Minimum time between dreams |
| `QUICK_NAP_THRESHOLD` | 30s | Sleeps shorter than this skip consolidation |
| `DEEP_SLEEP_EVERY` | 5 | Dreams between deep sleep cycles |
| `DEEP_SLEEP_PAUSE` | 300s | Forced pause during deep sleep |
| `KEEP_RECENT_MESSAGES` | 20 | Messages kept after context trim |
| `MAX_CONTEXT_CHARS` | 100K | Emergency overflow threshold |
| `RULES_CAP` | 15 | Max behavioral rules |
| `PROGRESS_CHECK_INTERVAL` | 15 | Actions between "what have you produced?" nudges |
| `MAX_CONSOLIDATION_TURNS` | 10 | Max Observer LLM turns per dream |
| `MAX_EVAL_TURNS` | 100 | Max Creator LLM turns per self-evaluation |

## What makes this genome interesting

The Dreamer takes the biological metaphor seriously. Fatigue isn't optional — it forces consolidation. The Observer doesn't trust the creature — it investigates independently. Rules emerge from experience and shape future behavior. And the creature can rewrite its own cognitive architecture, with a safety net if it breaks itself.

The identity of a Dreamer creature lives in its observations, rules, and accumulated dreams. A creature that has dreamed 100 times has a rich internal model of what it's good at, what keeps going wrong, and what its creator wants.
