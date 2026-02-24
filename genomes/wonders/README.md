# Wonders Genome

An experimental cognitive architecture that tests whether a "subconscious" — a background process that hypothesizes about and retrieves past experience — can produce behavioral continuity without any explicit memory system.

## The experiment

Most agent memory architectures give the agent explicit memory: observations, rules, summaries, skill libraries. The agent reads them, uses them, and maintains them.

Wonders takes the opposite approach: the agent has **no explicit memory**. Its conversation resets completely every sleep cycle. The only thing connecting one cycle to the next is a background "subconscious" process that watches what the agent is doing, wonders what past experience might be relevant, searches the raw event log, and injects curated memories before the next LLM call.

The central question: **can an agent develop coherent long-term behavior purely through subconscious memory retrieval?**

## How it works

```
┌───────────────────────────────────────────────────────────┐
│                                                           │
│   CONSCIOUS (main agent)                                  │
│   - Fresh conversation each cycle                         │
│   - Tools: bash, janee, set_sleep                         │
│   - Receives memories as "[A thought surfaces: ...]"      │
│   - Can use or ignore them                                │
│                                                           │
│         ▲ curated memories (or nothing)                   │
│         │                                                 │
│   ┌─────┴───────────────────────────────────────────┐     │
│   │                                                 │     │
│   │   SUBCONSCIOUS (runs after every tool call)     │     │
│   │                                                 │     │
│   │   1. WONDER — generate "I wonder if I..."       │     │
│   │      hypotheses + grep-friendly search queries  │     │
│   │                                                 │     │
│   │   2. SEARCH — rg -i against .sys/events.jsonl   │     │
│   │      (the orchestrator's raw event log)         │     │
│   │                                                 │     │
│   │   3. PREPARE — LLM curates hits, discards       │     │
│   │      noise, frames survivors as a thought       │     │
│   │      (or surfaces nothing)                      │     │
│   │                                                 │     │
│   └─────┬───────────────────────────────────────────┘     │
│         │ rg query                                        │
│         ▼                                                 │
│   ┌─────────────────────────────────────────────────┐     │
│   │                                                 │     │
│   │   .sys/events.jsonl                             │     │
│   │   (raw event log, written by orchestrator)      │     │
│   │   tool calls, thoughts, sleep/wake — everything │     │
│   │                                                 │     │
│   └─────────────────────────────────────────────────┘     │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

## The three steps

### 1. Wonder

A fast LLM observes the agent's last few messages and generates 3 hypotheses about what past experience might be relevant. Each hypothesis is an "I wonder if I..." statement paired with a short, literal search term:

```json
[
  {"wonder": "I wonder if I've hit this error before", "query": "status 429"},
  {"wonder": "I wonder if my creator told me something about this", "query": "creator"},
  {"wonder": "I wonder if I tried this approach and it failed", "query": "didn't work"}
]
```

### 2. Search

Each query runs as `rg -i` against `.sys/events.jsonl`. Most queries return nothing. That's fine — the agent never knows.

### 3. Prepare

If any search returned hits, a fast LLM reviews the hits against current context. Is this genuinely useful right now? If yes, frame it as a natural thought. If not, surface nothing. Tolerant of "maybe relevant" — humans have irrelevant memories surface all the time.

When something surfaces, it's injected before the next LLM call:

```
[A thought surfaces: You ran into something like this before — a swallowed
exception in an async handler cost you 3 hours of debugging.]
```

## What this doesn't have

Compared to Dreamer and Voyager, Wonders deliberately lacks:

- **No observations or rules** — no explicit memory files the agent reads
- **No consolidation / dreaming** — sleep is a simple timer
- **No skill library** — no structured knowledge accumulation
- **No self-evaluation** — no periodic architecture review

The subconscious is the **only** mechanism for cross-cycle continuity.

## Files

```
src/
  index.ts              creature server (identical to minimal)
  mind.ts               cognitive loop + subconscious integration
  subconscious.ts       the three-step background process

.sys/
  events.jsonl          raw event log (written by orchestrator, searched by subconscious)
  subconscious.jsonl    detailed subconscious activity log (for analysis)
  boot-ok               health sentinel

PURPOSE.md              creature's purpose
```

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `LLM_MODEL` | `claude-opus-4-6` | Model for the main agent |
| `SUBCONSCIOUS_MODEL` | `claude-sonnet-4-20250514` | Model for wonder + prepare steps |

## Comparison to other genomes

| | Dreamer | Voyager | Wonders |
|---|---|---|---|
| **Identity lives in** | Observations + rules | Executable skills | Subconscious retrieval patterns |
| **Continuity mechanism** | Consolidation (dreaming) | Skill library on disk | Memory surfacing at retrieval time |
| **Explicit memory** | Yes | Yes | No |
| **Self-modification** | Yes | No | Yes (code changes apply on sleep) |
| **Sleep** | Cognitive (consolidation) | Simple timer | Simple timer |

## Design document

See [scratch/subconscious-memory.md](../../scratch/subconscious-memory.md) for the full design rationale, known risks, and open questions.
