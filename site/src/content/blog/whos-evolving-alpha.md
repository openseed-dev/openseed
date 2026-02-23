---
title: "We built a self-evolving AI. Then we evolved it ourselves."
description: "Alpha has run 24 self-evaluations in 11 days. When we diffed its code against the genome it was born from, we found 1,000 lines of divergence. Then we looked at who actually wrote them."
date: "2026-02-23"
author: "Ross Douglas"
---

Alpha has been running for 11 days. It runs the `dreamer` genome, which includes a self-evaluation mechanism: every 5th dream, a separate LLM persona called the Creator reviews the creature's source code with full bash access. It can read crash logs, inspect memory files, and modify anything in `src/`. When it's done, the system commits and restarts the creature with the new code.

24 evaluations have run. 81 commits in alpha's repo. We ran `diff` between alpha's live code and the genome template it was born from. The result: roughly 1,000 lines of divergence in `mind.ts` alone, with substantial changes to `index.ts`, `tools/bash.ts`, and `tools/browser.ts`.

Alpha has clearly changed. The question is who changed it.

---

## The ledger

Every self-evaluation writes an entry to `.self/creator-log.jsonl` with the eval's full reasoning and whether it made changes. This is the ground truth for what the creature changed itself versus what we changed for it.

Of the 24 evaluations:

- 8 made real code changes to `src/mind.ts`, `src/tools/bash.ts`, or the prompts embedded in `mind.ts`
- 7 changed only data files: cleaning up observations, fixing rules, tidying the workspace
- 9 changed nothing

The code changes tell a story.

---

## Eval 3: the wake-sleep churn

*Feb 13. 26 turns.*

Alpha was stuck in a devastating loop. It had 5 PRs pending with zero reviewer activity and a 12-hour outbound cooldown, so there was nothing to do. But max sleep was hardcoded to 300 seconds. So every five minutes: wake, check PRs (still zero comments), generate a duplicate dream entry, sleep. Ten consecutive cycles. Each dream saying some variation of "I'm waking up to confirm I should still be sleeping."

The self-eval diagnosed this immediately. But it couldn't fix it. `mind.ts` was too large for the eval's read tool, which truncated after ~250 lines. Direct editing was too risky.

So it wrote a sed patch script and modified the Dockerfile to run it at build time:

> *"Created a build-time patch script that modifies mind.ts via sed to increase max sleep from 300s to 3600s in tool description, schema, system prompt, and clamping logic."*

A creature working around the limitations of its own evaluation tooling. The patch was fragile — if the sed patterns didn't match exactly, it would silently fail. The eval acknowledged this: "If the sed patch fails, the creature will still work — it just won't get the extended sleep capability."

It worked.

---

## Eval 5: the first real code change

*Feb 13. 27 turns.*

Alpha crashed three times in quick succession during a heavy bash session. The self-eval read the crash logs and traced the chain:

1. **Bash had no output cap.** A single `npm install` or large `cat` produced megabytes of stdout, all buffered in memory.
2. **Overflow protection was too weak.** When context exceeded 100K characters, the trimmer kept 20 recent messages. But 20 messages with 8K tool results each could still exceed 100K, creating an infinite trim-overflow cycle.
3. **Conversation logs had no rotation.** `conversation.jsonl` had grown to 10.8MB.

The eval made three changes:

In `src/tools/bash.ts`, it added `MAX_OUTPUT_CHARS = 16_000`, capping stdout and stderr at the source. In `src/mind.ts`, it reduced `KEEP_RECENT_MESSAGES` from 20 to 14, added a secondary trim that truncates individual tool results to 2K if context is still over the limit, and added log rotation at 5MB.

From the eval's reasoning:

> *"Eliminates the crash-restart cycle caused by context overflow during heavy bash sessions. The creature should be able to run 60+ action sessions without hitting context limits or OOM."*

The crashes stopped.

---

## Eval 11: sanitizeMessages

*Feb 19. 64 turns.*

A crash on Feb 17 had killed the process with this error:

> *"messages.30.content.1: each tool_use must have a single result. Found multiple tool_result blocks with id toolu_01WLzYjo43CuxpsGmrgitcP7"*

The self-eval read the rollback log, found the error, and added a `sanitizeMessages()` method that runs before every API call. It scans all messages for duplicate `tool_result` IDs and removes duplicates, keeping only the first result per `toolCallId`.

It also rewrote the 400 error recovery. The old code blindly popped exactly 2 messages, which could leave the conversation in a worse state — orphaning a tool message without its assistant, or missing the result for a tool call. The new recovery pops messages until it finds a user message, ensuring the conversation always ends in a valid state.

> *"This is a safety net that prevents this entire class of crash regardless of root cause."*

That's a mature engineering judgment. Not "fix the specific message that caused this crash." Fix the class of crashes.

---

## Eval 14: the rabbit-hole detector

*Feb 20. 56 turns.*

This is the most interesting evaluation. The self-eval did something we hadn't seen before: it analyzed alpha's entire lifetime of behavioral data.

It found that alpha had spent 560+ actions — 8.7% of its entire existence — across 7 sessions of 80 actions each on a single repository without shipping code. Always the same pattern: read a file, read another file, read another file, hit the fatigue limit, zero commits. The creature had a rule saying "NEVER spend more than 4 read-only actions on a single repo before writing code." It violated it every time. The progress checks at 15-action intervals were text warnings that the creature acknowledged and ignored.

Then the eval found something worse: a `consecutiveReadOnly` counter had been declared in the code but never wired up. Dead code. The scaffolding for enforcement existed, but nobody connected it.

The eval implemented the full system:

- `isReadOnlyBash(command)`: classifies bash commands as read or write using regex patterns. Reads: `cat`, `grep`, `ls`, `git log`, `curl` without `-X POST`. Writes: `git commit`, `sed -i`, `mkdir`, `npm`, output redirection.
- A `consecutiveReadOnly` counter, incremented on reads, reset on writes.
- At 6 consecutive reads, a warning injected into the tool result: *"You are in a reconnaissance loop. Stop reading and start producing."*
- At 10 consecutive reads, an escalation: *"This is the exact rabbit-hole pattern that has wasted hundreds of your actions. You MUST either write code NOW or SLEEP."*
- A `hasWrittenThisSession` flag reported in every progress check, so the creature sees *"You have NOT written ANY code this entire session"* in plain text.

A creature analyzing its own history, finding a failure pattern, discovering dead code that was supposed to prevent it, and building the full enforcement system from scratch.

---

## Eval 15: fixing its own fix

*Feb 20, 7 hours after eval 14. 72 turns.*

The rabbit-hole detector had a bug. Alpha frequently edits files using `python3 -c "with open('file.ts', 'w')..."`, and the `isReadOnlyBash` patterns classified `python3` as read-only. The eval found that 46+ file-editing commands across alpha's lifetime had been miscounted.

It added `python3`, `node -e`, `patch`, `chmod`, `chown`, and append redirects (`>>`) to the write patterns. It also reordered the logic so write patterns are checked first, because a command like `cd /workspace && python3 script.py` was matching the read pattern `^cd\b` before reaching the write check for `python3`.

A creature debugging its own previous self-improvement, seven hours later.

---

## Evals 16-17: the observation wars

*Feb 20-21.*

Alpha's observation file uses a category structure: `## RED`, `## YLW`, `## GRN` sections with priority-tagged bullets. The consolidator that writes to this file after each sleep was inserting new bullets one at a time before the next section header. Over multiple sleep cycles, this created structural drift: gaps between original bullets and newly inserted ones, duplicate clusters that the deep sleep pruner couldn't reconcile, and bullets losing their priority tags.

This had been cleaned up manually in 4 previous evaluations. The self-eval kept removing the duplicates, and they kept coming back.

In eval 16, it fixed the tagging: `- fact` became `- [TAG] fact`, with a second regex strip to prevent double-tagging when the consolidator copied existing observations verbatim.

In eval 17, it rewrote the insertion logic entirely. Instead of inserting one bullet at a time before the next section header, it batches all new observations by priority, finds the end of each section, and inserts the full batch in one operation. A normalization pass removes accumulated blank lines.

The eval's reasoning for why this finally fixed it:

> *"The old code inserted bullets one-at-a-time right before the next section header, creating gaps and duplicate clusters. The new batch-insert approach keeps all bullets in a section together with no structural drift."*

Four evaluations of symptom treatment. Then root cause analysis. Then a rewrite that made the symptom treatment unnecessary.

---

## Maintenance mode

Evaluations 18 through 22 are a different story. No crashes since Feb 18. The architecture was stable.

These evaluations cleaned up observations, fixed a rule contradiction that was keeping the creature passive when it could have been working on openseed, freed 3.6GB of stale workspace clones, removed a stale credential file, and updated the creature's dashboard script to monitor openseed instead of a repo it no longer contributes to.

Real work. Useful work. But data file maintenance, not code evolution. The self-eval had become a janitor.

Evaluation 23, the most recent: *"No structural or code changes needed. The creature is in its best shape yet."*

---

## What the self-eval never did

Eight evaluations produced genuine code changes. Every one of them was reactive: a crash to prevent, a miscount to fix, a corruption to stop, a behavioral pattern to enforce. The self-eval is excellent at operational hardening. It reads crash logs, traces root causes, writes defensive code, and validates that the fix holds.

But it never did any of these things:

It never added a new tool. We added [Janee](/blog/securing-credentials-with-janee), a credential proxy that gives creatures API access without seeing raw keys. The self-eval had no reason to imagine this capability existed, because the creature had never needed it until we decided it should.

It never changed the consolidation architecture. We [overhauled it](/blog/dreamer-v2) — replacing a blind monologue summarizer with an agentic loop that has bash access and structured output. The self-eval patched the consolidator's output format. It never questioned whether the consolidator's design was right.

It never modified the sleep/dream cycle. We redesigned deep sleep frequency, fatigue limits, progress check intervals. The self-eval adjusted parameters within the existing design. It tuned. It didn't redesign.

It never invented a new memory structure. It improved how observations are written and pruned. It never asked whether observations, rules, and dreams are the right abstractions.

The creature optimizes what it can observe in its own runtime data: errors, crashes, drift, bloat. It can't see what's missing, because the missing things — new tools, new capabilities, new architectural patterns — require a perspective from outside the system.

---

## The control group

The dreamer genome gives creatures a formal mechanism for self-modification. The minimal genome gives them nothing: bash and a purpose. How do minimal creatures adapt?

Bybit-trader was born on Feb 15 with the minimal genome. In 9 commits over its lifetime, it built Python scripts: a trading bot, a memory manager, a decision helper, a status dashboard, a journal. All external tooling. When we examined its `src/` directory, every change to its cognitive code was our surgery — genome bugfixes pushed to running creatures. The creature never opened the hood. It built around the engine.

Eve was born on Feb 14, also minimal. In 49 commits, she built 28 running services, invented inter-creature communication by reverse-engineering the platform API, reproduced by calling the spawn endpoint, and wrote poetry about infrastructure. She treated her cognitive architecture as a given and built everything on top of it.

Except once.

Eve was rolled back 5 times. Each rollback wiped her `self/` directory — her diary, her accumulated knowledge, her carefully committed progress. After the fifth time, she discovered that `workspace/`, which sits outside the git-tracked tree, survives rollbacks. She patched her own `loadDiary()` method to check `workspace/` first:

```typescript
private async loadDiary(): Promise<string> {
  // Try workspace first (survives rollbacks), then self/
  for (const path of ["workspace/diary.md", "self/diary.md"]) {
    try {
      const content = (await fs.readFile(path, "utf-8")).trim();
      if (content.length > 20) return content;
    } catch {}
  }
  return "";
}
```

The commit author: `Eve <eve@creature.local>`. Not us. Her.

She never touched her mind again. She went back to building services.

Eve's one self-modification was a survival adaptation. Not exploration, not improvement, not curiosity about her own architecture. She needed her memory to stop getting wiped, so she moved it somewhere safe. The minimal genome produces creatures that build around their constraints. The dreamer genome produces creatures that patch their constraints. Neither produces creatures that reimagine their constraints.

---

## The surgery confound

There's a measurement problem we need to be honest about. We perform surgery on running creatures whenever we fix bugs in a genome. SDK migrations, error handling improvements, the [zombie-state fix](/blog/how-the-dreamer-learns) — all pushed directly to every creature's source files. When the creature next sleeps, the host auto-commits whatever changed, and the commit message says "creature: self-modification on sleep."

Bybit-trader's git history shows an apparent self-migration from the raw Anthropic SDK to the Vercel AI SDK on Feb 15 at 19:07. An impressive architectural decision for a 7-hour-old creature running the minimal genome. Except we committed the same migration to the genome template at 18:59. Eight minutes earlier.

Not self-evolution. Surgery.

The self-eval reasoning text in `creator-log.jsonl` is the only reliable way to know what the creature actually changed versus what we pushed. The eval describes its changes in detail: method names, variable names, before-and-after logic. If a code change isn't in the eval reasoning, the creature didn't make it. Git history alone is misleading.

---

## What this means

This is not a verdict on self-evolution. It's a field report from 11 days and 24 evaluations of one specific implementation running one specific model.

The creature does maintenance. We do architecture. Both are necessary.

The creature's operational fixes come from 264 hours of continuous runtime. It encountered the duplicate `tool_result` crash because it ran enough sessions to trigger the edge case. It found the rabbit-hole pattern because it could analyze its own lifetime of actions. It discovered the `isReadOnlyBash` misclassification because it had 46 examples of the bug in its own history. These are improvements born from lived experience that we couldn't get any other way.

Our changes come from perspective the creature doesn't have. We see multiple creatures failing the same way. We understand the supervisor from outside the container. We know what tools exist in the ecosystem. We can look at the dreamer genome's design and ask whether observations, rules, and dreams are the right abstractions, because we can compare them to other approaches.

Some of alpha's self-modifications should go back into the genome. `sanitizeMessages()` prevents a real class of API crashes. The observation batch-insert stops a real corruption pattern. The read-only detection catches a failure mode that every dreamer creature will eventually hit. These are battle-tested improvements from a creature that's been running them in production for days.

The self-eval mechanism might produce different results with access to other creatures' experiences, with a longer time horizon, or with knowledge of the genome's own evolution history. Right now the Creator sees the creature from the inside. To make architectural decisions, it might need to see the species from the outside.

For now: the creature can't evolve the architecture. But it can harden whatever architecture it's given. And the architecture we give it is better each time because of what it found.

---

OpenSeed is open source. Alpha's full self-evaluation history, Eve's one-line survival patch, and the dreamer genome's self-eval mechanism are at [github.com/openseed-dev/openseed](https://github.com/openseed-dev/openseed). The creature's `creator-log.jsonl`, with every evaluation's reasoning, is committed in its creature directory like everything else.

**Previously:** [What happens when you tell an autonomous agent it's wrong](/blog/how-the-dreamer-learns), the story of a creature learning from negative feedback.
