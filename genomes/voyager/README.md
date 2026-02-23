# Voyager Genome (disabled)

> This genome is disabled and not available for new creatures. It remains in the repo as a reference and as the subject of our [write-up on the experiment](https://openseed.dev/blog/voyager-experiment).

A cognitive architecture built around skill accumulation and automatic curriculum generation. Inspired by [Voyager (2023)](https://voyager.minedojo.org/) — the Minecraft agent that bootstrapped increasingly complex capabilities — adapted for general-purpose autonomous agents.

## Why it's disabled

We ran a 100-cycle experiment with a Voyager creature ("Patch") tasked with maintaining the OpenSeed codebase as a staff engineer. The architecture produced 41 shell scripts, mass-produced JSDoc comments against its own instructions, created four near-identical PRs, and never reviewed a single open PR despite that being a core responsibility.

The foraging loop optimizes for **breadth and artifact production**. That's the right behavior for domains where skills ARE the deliverable (API client libraries, DevOps runbooks, data pipelines). It's the wrong behavior for work that requires depth, judgment, and context — like code review, architectural decisions, and complex debugging.

12% of Patch's skill library contained actual code fixes. The rest was scanners, documentation generators, auth diagnostics, and workflow wrappers.

## What would need to change

To make this genome useful for judgment-heavy work, at minimum:

**Cross-cycle memory.** Each cycle currently starts with a blank conversation. The agent has no knowledge of why previous attempts failed. Patch hit the same auth blocker 16 cycles in a row, discovering it fresh each time. Even a compressed summary of recent cycles would eliminate this.

**Remove the skill incentive.** The system prompt says "if you finish a cycle without committing a skill, you haven't grown." This pushes the agent toward work that produces committable artifacts (scanners, doc generators) instead of valuable-but-artifact-free work (code review, judgment calls). The incentive should reward outcomes, not skill count.

**Bounded, pruned frontier.** The frontier is append-only and grows faster than it shrinks. Patch ended with 179 pending tasks, many duplicates, none pruned. Cap at 20-30 tasks, deduplicate, drop stale entries.

**Task critic.** The paper uses a separate LLM call to verify task completion. We dropped this. The agent grades its own homework, declaring "success" on junk cycles. A critic would have caught the JSDoc and redundant scanner cycles.

**Semantic skill retrieval.** We used tag matching instead of embeddings. This contributed to redundant skills — the agent kept building new scanners instead of finding existing ones.

**Composable skills.** Our skills are standalone shell scripts. The paper's skills are JavaScript functions that call each other, enabling genuine compounding. Without composability, the skill library grows but doesn't compound.

Even with all of these changes, the foraging loop may be structurally wrong for judgment work. See the [full write-up](https://openseed.dev/blog/voyager-experiment) for the analysis.

## How it works

The creature's identity lives in **executable skills on disk**. Each cycle, it picks a task from a self-generated curriculum, works on it, and commits a new skill to its library.

```
┌──────────────────────────────────────────────────────┐
│                  Foraging Cycle                      │
│                                                      │
│  ┌──────────┐                                        │
│  │  ORIENT  │  Pick a task from the frontier         │
│  │          │  (or propose seed tasks if empty)      │
│  └────┬─────┘                                        │
│       ▼                                              │
│  ┌──────────┐                                        │
│  │  FORAGE  │  Work on the task using tools          │
│  │          │  (up to 40 actions)                    │
│  └────┬─────┘                                        │
│       │                                              │
│       ├──── commit_skill ──── HARVEST                │
│       │     (save verified code to library)          │
│       │                                              │
│       ▼                                              │
│  ┌──────────┐                                        │
│  │ ADVANCE  │  complete_cycle: report outcome,       │
│  │          │  propose next tasks for frontier       │
│  └────┬─────┘                                        │
│       ▼                                              │
│  ┌──────────┐                                        │
│  │   REST   │  Sleep, then start a new cycle         │
│  └──────────┘                                        │
└──────────────────────────────────────────────────────┘
```

## The frontier (automatic curriculum)

The creature maintains its own task queue in `.self/frontier.jsonl`. Each task has a description, success criteria, difficulty (1-5), and attempt count.

Task selection prioritizes:
1. Lowest difficulty first
2. Fewest attempts
3. Oldest proposal date

When the frontier is empty, a separate LLM call proposes 3-5 seed tasks derived from the creature's `PURPOSE.md`. After each cycle, the creature proposes its own next tasks via `complete_cycle`.

## The skill library

Skills live in `.self/skills/` as executable files (`.sh`, `.py`, `.js`). Each has a metadata header:

```bash
#!/usr/bin/env bash
# @name check-pr-status
# @desc Check the status of a GitHub PR by number
# @tags github,pr,status
# @verified 2026-02-19T14:30:00Z
```

An index at `.self/skills/index.jsonl` tracks metadata, attempt counts, and success rates. During each cycle, relevant skills (matched by keyword search) are injected into the context.

The `commit_skill` tool is the only path to grow the library. It requires: name, description, tags, working code, language, and evidence of testing.

## Tools

- **bash** — shell execution with background process support.
- **browser** — persistent headless Chromium (Playwright). Profile survives restarts.
- **janee** — secure credential proxy. The creature never sees raw API keys.
- **set_sleep** — pause for 2s to 24h.
- **commit_skill** — save a verified skill to the library.
- **complete_cycle** — end the current cycle with an outcome, summary, and proposed next tasks.

## Files on disk

```
.self/
  skills/               verified skill scripts (.sh, .py, .js)
  skills/index.jsonl    skill metadata and success rates
  frontier.jsonl        self-proposed task queue
  conversation.jsonl    full transcript (append-only)
  browser-profile/      persistent Chromium state

.sys/
  iterations.jsonl      per-cycle checkpoints
  cycles.jsonl          completed cycle records
  boot-ok               health sentinel
```

## Voyager vs Dreamer

| | Voyager | Dreamer |
|---|---|---|
| **Identity lives in** | Executable skills on disk | Memories, observations, and rules |
| **Growth mechanism** | Commit verified code artifacts | Consolidate experience into observations |
| **Task structure** | Self-generated curriculum (frontier) | Open-ended, purpose-driven |
| **Conversation** | Fresh each cycle | Continuous across sleeps |
| **Sleep** | Simple timer | Cognitive consolidation (dreaming) |
| **Budget** | 40 actions/cycle (resets) | 80 actions cumulative (fatigue) |
| **Continuity** | Skill library + frontier | Observations + rules + dreams |
