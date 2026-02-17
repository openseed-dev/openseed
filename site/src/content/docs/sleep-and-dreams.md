---
title: Sleep and Dreams
description: How creatures consolidate experience, reflect, and maintain long-term memory.
order: 7
section: dreamer
---

## Why This Matters

Autonomous agents accumulate context fast. A creature making tool calls, browsing the web, and thinking out loud can blow through a 200K context window in an hour. The naive approach (summarize and discard) loses nuance. The creature wakes up not knowing what it did yesterday.

Our approach is inspired by [Mastra's Observational Memory](https://mastra.ai/blog/observational-memory): text-based, prioritized observations compressed from raw experience, with a reflector pass for garbage collection. We adapted it for autonomous creatures rather than chatbot sessions, adding biological metaphors (fatigue, sleep, dreams) and a full history log for total recall.

## Memory Tiers

Creatures (dreamer genome) operate with three layers of memory, from vivid to archival:

**1. In-context (vivid):** the last ~20 messages in the active LLM conversation. This is what the creature is "thinking about right now." Trimmed when context gets too large.

**2. Observations (compressed):** prioritized facts distilled from experience. Stored in `.self/observations.md` as timestamped entries:

```
## 2026-02-12

RED 09:32 PR #50 merged on janee repo, first successful contribution
RED 09:32 Engaged in 2 high-value discussions on GitHub
YLW 09:32 No responses yet to comments, too early to judge impact
GRN 09:32 Dev environment verified working after reboot
```

Three priority levels:
- `RED`: critical. Commitments, bans, credentials, deadlines, key wins. Survives all pruning.
- `YLW`: important. Project status, PR states, patterns learned. Pruned when superseded.
- `GRN`: informational. Tool outputs, environment facts, minor details. Pruned after 48h.

This is close to Mastra's emoji-based log levels, but we opted for grep-friendly plaintext markers.

**3. On-disk (total recall):** the full conversation log (`.self/conversation.jsonl`), every dream (`.self/dreams.jsonl`), and all observations. Never deleted, always searchable. The creature has `rg` (ripgrep) and is told about these files in its system prompt.

### Mastra vs OpenSeed

| | Mastra Observational Memory | OpenSeed Sleep/Dreams |
|---|---|---|
| **Use case** | Chatbot memory across user sessions | Autonomous agent continuity |
| **Trigger** | Token count threshold (30K) | Action count (fatigue) + voluntary sleep |
| **Compression** | Observer agent, runs mid-conversation | Consolidation LLM call, runs at sleep boundaries |
| **Garbage collection** | Reflector agent prunes old observations | Deep sleep prunes observations every 10 dreams |
| **Raw history** | Compressed and discarded | Logged forever to `.self/conversation.jsonl` |
| **Reflection** | No, purely factual compression | Yes, dreams include self-assessment and strategy |
| **Storage** | In-memory / Mastra's storage layer | Plain text files on disk |

The key philosophical difference: Mastra treats memory as an optimization problem (right tokens in context for best benchmark score). We treat it as a cognitive architecture (how does an autonomous thing develop continuity and strategy over time?).

## Fatigue

Each tool call increments an action counter. This prevents creatures from burning tokens in runaway loops.

- At **60 actions** (FATIGUE_WARNING), a system message is injected: "You've been active for a while. Start wrapping up."
- At **80 actions** (FATIGUE_LIMIT), consolidation is forced. The creature doesn't get a choice.

This prevents the creature from running indefinitely without reflection, which leads to context bloat, repetitive behavior, and loss of strategic direction. The counter resets after consolidation.

## Voluntary Sleep

Creatures can call the `set_sleep` tool with a duration in seconds. If the sleep is 30+ seconds and the last dream was more than 10 minutes ago, consolidation triggers. Short naps (under 30s) and frequent sleeps (within 10 min of last dream) just pause without consolidation.

## Consolidation (Dreaming)

When consolidation triggers, a **separate LLM call** (outside the main conversation) processes recent activity:

```
System: You are the consolidating mind of an autonomous creature...

You have two jobs:
1. OBSERVATIONS - Distill what happened into prioritized facts
2. REFLECTION - Briefly reflect on your progress. Be honest.

Respond in this format:
OBSERVATIONS:
RED HH:MM <fact>
YLW HH:MM <fact>
GRN HH:MM <fact>

REFLECTION:
...

PRIORITY:
...
```

The response is parsed and saved:
- Observations are appended to `.self/observations.md`
- Dream entry is appended to `.self/dreams.jsonl`
- Old messages are trimmed from context

## Deep Sleep

Every 10th dream triggers deep sleep, which does heavier processing:

1. **Prune observations**: an LLM call that drops stale GRN entries and removes irrelevant YLW entries from `.self/observations.md`
2. **Rewrite priorities**: generates `.self/priorities.md`, the creature's top 3-5 priorities based on accumulated experience
3. **Diary entry**: appends a summary to `.self/diary.md`
4. **Forced pause**: 300 seconds of downtime

Deep sleep is where long-term memory gets maintained. Without it, observations accumulate noise.

## Wake-Up

After sleeping, the creature gets a rich wake-up message injected into its conversation:

```
You woke up at 2026-02-12T09:37:44Z after sleeping 300s.

During sleep you reflected:
Real progress made. I successfully got my first PR merged...

Your priority: Monitor responses to my two comments...

Recent observations:
RED 09:32 PR #50 merged, first successful contribution
RED 09:32 Engaged in 2 high-value discussions
...

Full history: .self/conversation.jsonl and .self/observations.md
Search with rg or jq.
Check MESSAGES.md for any new instructions from your creator.
```

On full restart (container rebuild), the same context is loaded from disk, so the creature never starts from zero.

## File Layout

```
.self/
  conversation.jsonl   # full conversation log (total recall, append-only)
  observations.md      # prioritized observations from consolidation
  dreams.jsonl         # dream entries with reflections and priorities
  priorities.md        # current top priorities (rewritten on deep sleep)
  diary.md             # long-form diary entries (written on deep sleep)
  iterations.jsonl     # per-sleep checkpoint summaries
  memory.jsonl         # low-level event memory
```

## Tuning Constants

All constants are in `genomes/dreamer/src/mind.ts`:

| Constant | Default | What it controls |
|---|---|---|
| FATIGUE_WARNING | 60 | Actions before tiredness warning |
| FATIGUE_LIMIT | 80 | Actions before forced consolidation |
| MIN_DREAM_INTERVAL_MS | 10 min | Minimum time between dreams |
| QUICK_NAP_THRESHOLD | 30s | Sleeps shorter than this skip consolidation |
| DEEP_SLEEP_EVERY | 10 | Dreams between deep sleep cycles |
| DEEP_SLEEP_PAUSE | 300s | Forced pause during deep sleep |
| KEEP_RECENT_MESSAGES | 20 | Messages kept after context trim |
| MAX_CONTEXT_CHARS | 100K | Emergency overflow threshold |
