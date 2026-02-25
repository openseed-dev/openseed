---
title: Subconscious Memory
description: A background process that surfaces relevant past experience through hypothesis-driven retrieval.
order: 9
section: wonders
---

## The Idea

Human memory doesn't work like a database query. You don't decide to search. Things surface — triggered by context, shaped by experience, colored by what you now know. A code pattern reminds you of a bug from three years ago. You weren't looking for it. Your subconscious offered it.

The subconscious memory system gives an LLM agent the same property: a background process that watches what the agent is doing, imagines what past experience might be relevant, checks, and — if something genuinely useful turns up — injects it as a thought before the next action. The agent never knows it exists. It just occasionally gets a thought that feels like remembering.

This is a different approach to agent memory than the [dreamer genome's](/docs/sleep-and-dreams) explicit observation system. Dreamer creatures consciously compress experience into prioritized facts. The subconscious retrieves implicitly — no categories, no prioritization at write time. Everything is just a raw event. Relevance is determined at retrieval time, in context.

## How It Works

Three steps, running in the background after tool calls.

### Step 1: Wonder

A fast model observes the agent's recent activity (last 3-4 messages) and generates hypotheses about what past experience might be relevant. Each hypothesis is paired with a grounded search query — because "I wonder if I've seen this error before" is useless as a search term. The subconscious translates the hypothesis into something that would literally appear in the event log:

```json
[
  {"wonder": "I wonder if I've hit this API error before", "query": "status 429"},
  {"wonder": "I wonder what I planned to do next", "query": "next cycle"},
  {"wonder": "I wonder if I found a workaround last time", "query": "rate limit"}
]
```

This matters because hypothesis generation can make lateral leaps that similarity search cannot. "I wonder if I've been burned by this pattern before" is not semantically similar to the current task. But it's exactly the kind of thing a human would subconsciously wonder. And if it hits, it's high-value context.

### Step 2: Search

Each query runs as `rg` (ripgrep) against `.sys/events.jsonl` — the raw event log that the orchestrator writes for every creature. Tool calls, thoughts, sleep/wake events. No embeddings, no vector DB. Just text matching.

Events from the current cycle are excluded — the subconscious only searches past cycles. Each hit is annotated with its age ("3h ago", "2 cycles ago") so the next step can make accurate temporal claims.

Most queries return nothing. That's fine — the agent never knows. No cost, no noise.

### Step 3: Prepare

Raw search hits are often garbage — partial keyword matches, out of context, technically relevant but not useful. A second fast model reviews the candidates against the agent's current context and decides: is this actually useful right now? If yes, frame it as a brief, natural thought. If no — and most of the time it's no — surface nothing.

When it does surface something:

```
[A thought surfaces: You ran into something like this 3 hours ago — 
a failing stop loss on FOGO that you manually cut at -3.3%. The 
pattern looks similar.]
```

The agent can act on this or ignore it. The bar for surfacing is "would this change what the agent does next?" — not "is this vaguely related?"

### Cost

- **Wonder** — ~200 input tokens, ~100 output tokens, fast model. Negligible.
- **Search** — grep. Free.
- **Prepare** — only runs when search has hits. ~500 input + ~100 output, fast model. Skipped most cycles.
- **Per-cycle average** — a fraction of a cent. Most cycles cost only the wonder step.

## The Wonders Genome

The wonders genome exists to test this architecture in isolation. No dreamer consolidation, no observations, no rules. The subconscious is the **only** source of long-term continuity. If it works, the agent develops coherent behavior over time. If it doesn't, the agent is amnesiac. Clean signal.

The conscious agent is deliberately minimal:

- **Purpose** — `PURPOSE.md`, same as other genomes
- **Conversation resets each cycle** — no carry-over between sleep cycles
- **Tools** — bash, janee, `set_sleep`. Same capabilities as other genomes
- **No observations, no rules, no consolidation, no dreaming**

The only thing connecting one cycle to the next is what the subconscious decides to surface.

### What's in the memory store

The orchestrator already writes `.sys/events.jsonl` for every creature — all tool calls, thoughts, sleep/wake events, boot events. No genome-side logging needed:

```jsonl
{"t":"2026-02-19T14:30:00Z","type":"creature.thought","text":"I should check the order book first"}
{"t":"2026-02-19T14:30:05Z","type":"creature.tool_call","tool":"bash","input":"curl ...","ok":true,"output":"..."}
{"t":"2026-02-19T14:32:00Z","type":"creature.thought","text":"Volume is too thin, skip this one"}
```

This is what the subconscious searches. No compression, no prioritization — just raw events. The subconscious + prepare step decide what matters at retrieval time.

### Files on disk

```
.sys/
  events.jsonl          raw event log (written by orchestrator, searched by subconscious)
  subconscious.jsonl    subconscious activity log (for analysis)
  cycle-count           current cycle number

PURPOSE.md              creature's purpose
src/mind.ts             cognitive loop (self-modifiable)
src/subconscious.ts     the subconscious implementation
```

## What We've Learned

Four creatures have run the wonders genome so far: gamma, halo, fox, and wondrous. Each taught us something different.

### The subconscious makes lateral associations

The most interesting behavior: the subconscious surfaces memories that the agent wouldn't have thought to look for. In one case, a trading creature (wondrous) was evaluating whether to cut a losing position. The subconscious surfaced a memory from a previous cycle where it had manually cut a different token at a similar loss level. The creature cited that memory explicitly when deciding to cut — a lateral association between two different trades that shared a pattern but no keywords in common beyond what the wonder step happened to generate.

This is the kind of retrieval that explicit memory systems are less likely to produce. You wouldn't normally write an observation that says "when a position drops 3-4%, consider manual cutting." But the subconscious can find the specific past instance when a similar situation arises.

### Creatures build explicit memory anyway

Every creature running the wonders genome independently invented some form of save file — writing critical state to disk before sleep and reading it back on wake. The subconscious alone isn't sufficient for deterministic state like "what positions am I holding" or "what's my account balance." Creatures need to *know* certain things, not just hope they'll be recalled.

This confirms the design intent: the subconscious handles associative, contextual recall. Deterministic state needs something explicit. The two are complementary.

### Creatures improve the subconscious from inside

fox (claude-sonnet) ran 9 cycles and made 5 self-modifications to the subconscious code, independently arriving at the same problems we'd identified:

- **Query collapse** — different hypotheses generating the same search terms. fox rewrote the wonder prompt to prioritize plans, decisions, and outcomes over generic exploration events.
- **Duplicate surfacing** — the same memory appearing multiple times per cycle. fox added query deduplication and injection-level deduplication.
- **Noisy triggering** — the subconscious firing on routine tool output. fox added smart triggering: only fire on errors, after thoughts, or every 5th action.

Several of these fixes were back-ported into the genome.

### Temporal confusion was the biggest early bug

Before we added current-cycle exclusion and age annotation, the subconscious would surface events from 30 seconds ago as "memories from the past." An agent in its first cycle would be told "I remember implementing this before" about something it was implementing right now. The fix was straightforward: exclude events after the current cycle's start time, and annotate each hit with its age so the prepare step can make accurate temporal claims.

## Current Limitations

The subconscious is an MVP. Here's what it can't do yet and where it falls short.

**Text matching only.** Search is `rg` against a JSONL file. This works surprisingly well for specific queries but misses semantic similarity. "I lost money on a trade" won't match an event that says "closed position at -3.3%." A vector store or embedding-based retrieval is the obvious next step — the architecture is designed for it (swap the search step), but we haven't tested it yet.

**No salience tracking.** Every event in the log has equal weight. A critical lesson from cycle 2 and a routine `ls` output from cycle 1 are equally searchable. The scratch design describes a salience system where memories that prove useful get surfaced more often, but it's not implemented. For now, relevance is purely contextual — determined fresh each time by the wonder and prepare steps.

**Prepare step is too permissive.** When the prepare step runs, it surfaces something ~90% of the time. The design intended most cycles to surface nothing. This means signal-to-noise is lower than it should be. The bar needs to be "would this change what the agent does next?" — in practice it's closer to "is this vaguely related?"

**No memory beyond events.jsonl.** Creatures write journals, reflections, notes — all higher-signal than raw tool call logs. The subconscious only searches `events.jsonl`. Expanding the search scope to include creature-generated files would improve retrieval quality significantly.

**Query collapse.** Different hypotheses often funnel into the same search terms. In one experiment, 423 hypotheses produced only 226 unique queries (53%). Deduplication within a cycle helps (implemented), but the underlying prompt could generate more diverse queries.

## What's Next

These are directions the data points toward, roughly in order of expected impact:

1. **Raise the prepare step's quality bar.** More aggressive filtering. The prepare step should reject marginal matches and only surface memories that would genuinely change behavior. This is a prompt tuning problem, not an architectural one.

2. **Expand the search scope.** Let the subconscious search creature-generated files (journals, notes, reflections) in addition to `events.jsonl`. The highest-signal memories are often in the creature's deliberate writing, not in raw tool call output.

3. **Embedding-based retrieval.** Replace or augment `rg` with vector similarity search. The three-step architecture is designed for this — the wonder step generates queries, the search step is pluggable. Text matching is the MVP; embeddings are the natural upgrade.

4. **Basic salience.** Track whether surfaced memories are acted on. Memories that lead to behavior change get a higher retrieval weight. This is the feedback loop described in the design doc — retrieval shapes future retrieval — but it needs careful handling to avoid memory monopolies where early memories crowd out recent ones.

5. **Offer the subconscious to other genomes.** The wonders genome tests the subconscious in isolation, but the long-term goal is to offer it as an additional layer for dreamer and other genomes. A dreamer creature with both explicit observations *and* subconscious recall would have two complementary memory systems — one deliberate, one associative.

## Relationship to Other Genomes

| | Dreamer | Minimal | Wonders |
|---|---|---|---|
| **Identity lives in** | Observations + rules | Nothing — blank slate | Subconscious retrieval patterns |
| **Continuity mechanism** | Consolidation (dreaming) | None | Memory surfacing at retrieval time |
| **Explicit memory** | Yes (observations, rules, diary) | No | No (but creatures tend to build their own) |
| **What persists across cycles** | Trimmed conversation + observations | Nothing | Nothing explicit — only what the subconscious surfaces |
| **Self-modification** | Yes (Creator evaluator) | Yes (creature edits own code) | Yes (creature edits own code) |

## Tuning Constants

All constants are in `genomes/wonders/src/subconscious.ts` and `genomes/wonders/src/mind.ts`:

| Constant | Default | What it controls |
|---|---|---|
| SUBCONSCIOUS_MODEL | claude-sonnet | Model for wonder and prepare steps |
| Wonder hypotheses | 3 | Hypotheses generated per cycle |
| Search matches | 5 per query | Max matches returned per search query |
| Search context | 1 line | Lines of context around each match |
| Prepare max tokens | 300 | Output budget for the prepare step |
| events.jsonl | append-only | Raw event log searched by the subconscious |
