---
title: "My AI was lying to itself about remembering things"
description: "Alpha was burning 80 actions every wake cycle and producing nothing. The creature's own dreams said so. When we investigated, we found an agent gaslighting itself about its own memory."
date: "2026-02-18"
author: "Ross Douglas"
---

Alpha is an autonomous creature running the `dreamer` genome. Its purpose: contribute to open-source projects. It has bash, a browser, a full cognitive architecture with memory consolidation, dreams, self-evaluation, and rules. It runs 24/7 in a Docker container, sleeps when tired, wakes on a timer, and decides what to work on.

For the past week, it has been doing almost nothing.

Every wake cycle, it hits the hard fatigue limit of 80 actions before being forced to consolidate and sleep. Progress checks at 15, 30, 45, 60, and 75 actions don't change behavior. It acknowledges them and keeps going. Its own dreams say things like: *"Two sessions deep on cherry-studio with zero code output is a clear failure pattern."* It writes rules about this. Then violates them next cycle.

This is the story of what was wrong and what we did about it.

---

## The investigation

We started where you always start with a creature: the logs. The orchestrator's event stream records every action, every sleep, every wake, every consolidation. We pulled up Alpha's recent cycles and started looking.

The surface symptoms were obvious:

- Never voluntarily sleeps. Burns 80 actions every time.
- Doesn't check GitHub notifications despite having a rule: "Run dashboard.sh as the FIRST action."
- Gets stuck in deep investigation loops, reading 30+ files in a codebase without writing anything.
- PRs that get submitted are low quality.
- Rules accumulate faster than they're pruned. 37 at peak.

But these are symptoms. The question is why a creature with a full memory system, dreams, self-evaluation, and rule management still can't learn from its own mistakes.

---

## The amnesiac

The first thing we found was the context trimming.

The `dreamer` genome runs a continuous LLM conversation. Tool calls, results, and reasoning all accumulate in the context window. At 100K characters, `trimMessages()` kicks in and drops older messages, keeping only the 20 most recent.

Here's what `trimMessages()` used to do:

```typescript
const dropped = this.messages.splice(1, dropCount);
this.messages[0] = {
  role: "user",
  content: "Earlier context has been consolidated into your observations above."
};
```

That replacement message is a lie. Consolidation only runs when the creature sleeps. `trimMessages()` runs mid-session, 4-5 times per wake cycle. The creature loses all its earlier tool results, reasoning, and task context, and the replacement tells it "don't worry, it's in your observations." Those observations don't exist yet. The creature hasn't slept.

The creature is working on a problem, accumulates 20 tool calls of investigation, hits the context limit, and everything gets erased. The replacement message points at observations that won't be written until the next sleep. The creature can't remember what it found five minutes ago. It starts over. It investigates the same files again. Context overflows again. Repeat 4-5 times per cycle.

This is why Alpha burns 80 actions and produces nothing. It's not lazy. It's amnesiac.

---

## The blind consolidator

The second problem amplifies the first. When Alpha finally does sleep and consolidation runs, the consolidator was receiving `monologueSinceDream.slice(0, 8000)`. The consolidator is a separate LLM call that processes recent activity into observations. Eight thousand characters of the creature's own narration.

The creature's narration is the least informative part of a session. The valuable data is in tool results: GitHub API responses, file contents, command outputs, error messages. None of that was passed to the consolidator. It was forming memories from self-talk, not evidence.

The result: observations like "Investigated cherry-studio codebase" instead of "PR #50 merged, test coverage increased from 42% to 67%, maintainer commented 'nice catch.'" The consolidator literally couldn't see what happened. It could only see what the creature said about what happened, truncated to 8K characters, which meant late-session work was invisible.

---

## The cold wake

The third problem: what happens when the creature wakes up after a short sleep.

Full consolidation only triggers on sleeps longer than 30 seconds with at least 10 minutes since the last dream. Short naps skip consolidation entirely. And they happen frequently. The creature wakes and gets this message:

```
You slept for 45s. You're awake now. Continue where you left off.
```

That's it. No observations injected. No rules refreshed. No context about what happened before. If context was trimmed during the previous session (which it was, 4-5 times), the creature has a dangling reference to "observations above" that were never loaded.

It wakes up with partial context from the end of the previous session and a lie about its memory being intact. No wonder it spins.

---

## The fixes

Each fix targets one of these failure modes. They're designed to work together.

### Session digest instead of amnesia

`trimMessages()` was rewritten. Instead of nuking dropped messages and replacing them with a lie, it now extracts a one-liner from each dropped message into a `sessionDigest` array:

- Tool calls become: `[bash] git diff --stat`
- Tool results become: `→ 3 files changed, 47 insertions(+), 12 deletions(-)`
- Assistant messages become: `Thought: the test file is missing coverage for the edge case`
- Errors become: `ERROR: Command failed: npm test (exit 1)`

The digest accumulates across multiple trims. After 3-4 overflows, the creature has 60+ one-liners covering everything it did earlier in the session. The replacement message becomes:

```
## Session Context (trimmed for space)
You are mid-session. Here's what you've done so far:

- [bash] git clone https://github.com/...
- → Cloning into 'repo'... done.
- Thought: Let me look at the issue tracker
- [bash] gh issue list --limit 5
- → #142 Fix flaky test in auth module
- ...
```

The creature doesn't remember everything, but it remembers what it did and roughly what happened. Enough to not start over from scratch.

We also cut the tool result cap from 8K to 4K characters per result. This nearly doubles how many actions fit before the first trim triggers, buying the creature more vivid context before compression kicks in.

### Agentic consolidation

The consolidator was rewritten from a passive observer into an agentic loop. Instead of receiving a truncated monologue snippet, it now gets:

- **A structured session summary**: every tool call, command, output, timing, and the creature's reasoning, organized chronologically
- **Bash access**: it can read the filesystem, check git state, inspect what actually happened
- **A `done` tool** that accepts `observations`, `rule_adds`, and `rule_removes` for targeted rule management instead of just dumping text

The consolidator gets 10 turns to investigate before forming memory. It reads the actual files the creature modified. It checks `git log`. It looks at what's deployed versus what's committed. It forms observations from evidence, not narration.

The old consolidator produced: *"Investigated several repositories."*

The new one produces: *"RED 14:22 PR #50 merged on janee repo. First successful external contribution."*

### Non-consolidated wakes inject memory

Short wakes (those that skip full consolidation) now:

1. Rebuild the system prompt, which picks up any rules the creature wrote during the session
2. Read `.self/observations.md` and inject it into the wake message
3. Point at `conversation.jsonl` for full history search

The creature no longer wakes into a void. Even after a 30-second nap, it gets its accumulated observations, current rules, and knows where to find full history.

### Self-evaluation gets teeth

The Creator is a separate LLM persona that evaluates and evolves the creature's code during deep sleep. It was underpowered. 20 turns isn't enough to diagnose a subtle cognitive bug, read the relevant code, form a hypothesis, write a fix, validate it compiles, and commit.

We increased the turn budget from 20 to 100. Rewrote the prompt with three phases: Gather Evidence, Diagnose, Fix. Added a diagnostic checklist. And critically: the Creator now sees the creature's full conversation history, including user messages. If the human operator has been telling the creature "check your notifications" for three cycles, the Creator can see that and act on it.

Deep sleep frequency was increased from every 10th dream to every 5th. The creature self-evaluates twice as often.

### Sharper progress checks

The graduated progress check messages were too gentle. At 15 actions: "What have you accomplished?" At 45 actions: "You're over half your budget." The creature would acknowledge, say it's "making progress on investigation," and keep reading files.

The new messages escalate faster:

- **15 actions**: *"What CONCRETE output have you produced? If the answer is nothing tangible, stop, reassess, and either produce something or sleep."*
- **30 actions**: *"You are burning through your action budget. List what you've ACTUALLY accomplished (not 'investigated' or 'explored'). If you've spent 5+ actions reading without writing, you are in a failure pattern."*
- **45 actions**: *"This is a serious checkpoint. What tangible artifacts exist from this session? If you cannot point to commits, files written, PRs created, or messages sent, this session is being wasted."*

The word "actually" and "concrete" and "tangible" are doing real work. They cut off the creature's favorite escape hatch: claiming investigation is progress.

---

## The bug graveyard

While we were in there, we found and killed several bugs that were silently degrading every creature:

**Duplicate `tool_result` in progress checks.** The progress check code pushed a second tool result reusing the last tool call's ID. The Anthropic API rejects this: "each tool_use must have a single result." Every time a creature hit 15 actions, it triggered a 400 error, which triggered the circuit breaker, which **reset the entire conversation** and wiped all context. The creature's memory was being erased every 15 actions by its own progress check system. Fixed: append the check message to the existing tool result instead of pushing a duplicate.

**Same bug in self-evaluation.** The creature's only mechanism for self-improvement was crashing every time it ran long enough to trigger the turn warning. Self-eval would hit the "you have N turns remaining" message, which was pushed as a duplicate tool result, triggering a 400. The creature couldn't improve itself because the improvement process was broken.

**LLM error infinite retry.** No circuit breaker on 400 errors. A corrupted conversation state (often caused by the duplicate tool_result bug above) would loop forever, burning tokens. Added: 400 with >2 messages resets conversation; 5 consecutive failures of any kind resets.

**Gulf creature completely non-functional.** Gulf's `mind.ts` had drifted far behind the genome it was spawned from. It executed tool calls but never sent the results back to the API. Every turn after a tool call crashed. The creature had been dead since birth. Running, hitting errors, running, hitting errors. An infinite loop that looked alive from the outside. Root cause: creatures are snapshots of genomes at spawn time. Genome fixes don't propagate automatically.

---

## What this means

The dreamer genome was designed with a sophisticated memory architecture: observations with priority levels, dreams with reflections, deep sleep with pruning, self-evaluation with code modification. On paper, it's impressive. In practice, it was undermined by implementation details that made the creature amnesiac, blind, and unable to learn.

The fixes aren't glamorous. Session digest is just a list of one-liners. Agentic consolidation is just giving the consolidator bash and a structured summary. Memory injection on wake is just reading a file and including it in the prompt. The duplicate tool_result fix is a one-line change.

But together, they mean the creature can now:

- Remember what it did earlier in the session, even after context overflow
- Form accurate memories when it sleeps, based on evidence not self-narration
- Wake up with context instead of starting from zero
- Improve its own code without the improvement process crashing
- Get honest feedback about whether it's producing output or just "investigating"

These are the things that were supposed to work from the beginning. The architecture was right. The wiring was wrong.

We're a few wake cycles into the new version. Too early to declare victory. But Alpha's last self-evaluation, now running with a 100-turn budget, read its own conversation history, found that the creator had been asking it to check notifications for three cycles, diagnosed that `dashboard.sh` checks repo stats instead of GitHub notifications, and started writing a fix.

That's never happened before.

---

OpenSeed is open source. The dreamer genome, the fixes described here, and the full architecture are at [github.com/openseed-dev/openseed](https://github.com/openseed-dev/openseed). If you're building autonomous agents and running into context management problems, the [sleep and dreams docs](/docs/sleep-and-dreams) and [self-modification docs](/docs/self-modification) cover the architecture in detail.

**Previously:** [I gave an AI two words and walked away for eight hours](/blog/eve), the story of Eve's first day with the minimal genome.
