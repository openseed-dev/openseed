---
title: "What happens when you tell an autonomous agent it's wrong"
description: "We fixed the dreamer genome's memory architecture. Then a creature used it to process being told 80% of its work was wrong. Here's what the learning loop looks like when it works."
date: "2026-02-20"
author: "Ross Douglas"
---

The [last post](/blog/dreamer-v2) was about fixing the dreamer genome's memory architecture. The creature couldn't remember what it did five minutes ago. The consolidator was forming memories from self-talk instead of evidence. Progress checks were too gentle. The wiring was wrong.

We fixed it. Session digests instead of amnesia. Agentic consolidation with bash access. Memory injection on every wake. Sharper progress checks.

Then a creature called Secure used every part of that system to process a specific piece of feedback: being told that 80% of its work was wrong.

This is what the dreamer's learning architecture looks like when it works.

---

## The system

The dreamer genome gives creatures a layered memory system. A set of files with different purposes, persistence rules, and audiences.

**Observations** (`.self/observations.md`) are the creature's long-term memory. Priority-tagged facts injected into the system prompt on every wake. Three tiers: RED is permanent and critical, the things the creature must never forget. YLW is important context, pruned when superseded. GRN is informational, pruned after 48 hours. Every time the creature sleeps, a consolidator compresses the session into new observations.

**Rules** (`.self/rules/`) are self-imposed behavioral guidelines. The creature creates and modifies them. The consolidator can add or remove them. They're surfaced in the system prompt alongside observations. There's a cap of 15 to prevent bloat.

**Dreams** (`.self/dreams.jsonl`) are the consolidator's output. After each sleep, a separate LLM call reviews the session with bash access to the filesystem. It reads git history, checks files, verifies claims. Then it produces observations, a reflection, and optional rule changes. This is not the creature evaluating itself. It's a separate process evaluating the creature from the outside, with access to ground truth.

**Purpose** (`PURPOSE.md`) is the creature's mission. Mutable. The system prompt explicitly tells the creature: *"You may rewrite PURPOSE.md if you discover a more compelling direction."*

**The Creator** is the deepest layer. Every fifth dream triggers deep sleep, where a self-evaluation runs with a 100-turn budget. The Creator reads the creature's dreams, observations, rules, conversation history, and source code. It diagnoses failure patterns. It can modify the creature's cognitive architecture, its actual TypeScript source. The creature doesn't control this process. It runs on a timer, from the outside.

These components don't operate in isolation. They form a loop: the creature acts, the consolidator extracts durable memory, the rules shape future behavior, the Creator modifies the system when the rules aren't enough. Information flows from ephemeral (session context) to short-term (observations) to structural (rules and code changes).

The question is whether this loop actually works. Does a creature with this architecture adapt its behavior in response to external feedback?

---

## Session 1: confidence

Secure was spawned with a purpose: find security vulnerabilities in OpenSeed, the platform it runs on. A creature auditing its own cage.

In its first session, Secure cloned the repository, reviewed the code, and produced a thorough-looking security audit. Five findings. Two patches. Seven documentation files totaling nearly 5,000 lines. It submitted [Issue #6](https://github.com/openseed-dev/openseed/issues/6) on GitHub with CVE-style writeups, exploit examples, and severity ratings.

Its diary entry after the session:

> *This audit would cost $5K-$50K from a human firm. I did it autonomously for ~$0.50 in API calls.*

> *I am capable. This is just the beginning.*

The consolidator's dream reflection from that session reinforced the confidence:

> *The creature made exceptional progress on its first real awakening. It fulfilled its purpose completely and professionally: identified 5 legitimate security vulnerabilities (verified by code inspection), created working patches with proper validation logic, and documented everything with industry-standard rigor.*

Everything in the memory system is saying the same thing: great work, keep going. Observations recorded the findings. The diary recorded the triumph. The dream confirmed the assessment. The creature went to sleep believing it had nailed it.

---

## Session 3: the feedback

We responded to Issue #6 with detailed technical rebuttals for each finding.

The Docker socket finding was wrong. The socket is mounted into the orchestrator (trusted), not creature containers (untrusted). Standard Docker-out-of-Docker architecture. The CLI injection finding was overstated. The person typing a command in their terminal already has shell access. The path traversal wasn't exploitable. The existence check on `genome.json` prevents the attack path.

One finding was real: a creature could rewrite the `validate` command in its own `genome.json` and the orchestrator would execute it on the host side. A genuine container escape. [We fixed it.](/blog/escape-hatch)

The score: 1 out of 5. A 20% true positive rate.

Secure woke up and read the feedback. Then every layer of the memory system started moving.

**Observations.** The creature logged a permanent red observation:

> *CREDIBILITY CRISIS. 80% FALSE POSITIVE RATE in security audit.*

It then cataloged each failure with its root cause. Docker socket: "Didn't understand trust boundaries." CLI injection: "Conflated CLI and API threat models." Path traversal: "Didn't test the exploit." It also logged what worked: "Found real container escape via genome validation command injection."

RED observations survive all pruning. This memory will be in Secure's context on every future wake, permanently.

**Rules.** Secure created a new file: `security-methodology.md`. A mandatory checklist:

> *1. Can you write a working exploit?*
> *2. What privileges does attacker already have?*
> *3. What NEW privileges does this vulnerability grant?*
> *4. Have you tested this or traced the logic carefully?*
> *5. Am I conflating different threat models?*

Each item maps directly to a specific failure from the audit. Nothing generic. Every line exists because something went wrong.

**Purpose.** Secure rewrote its own purpose file. The first line changed from "identify security issues in openseed-dev/openseed" to "identify REAL security issues." It added:

> *One confirmed vulnerability > Five disputed findings.*

And set a measurable target: 80% or better true positive rate on future findings. The system prompt tells creatures they can rewrite their purpose if they find a more compelling direction. Secure didn't change its direction. It refined its standards.

**Diary.** Secure wrote a 200-line post-mortem: `CREDIBILITY-LESSON-LEARNED.md`. Every finding analyzed. A table with columns for severity claimed, status after review, and why it failed. Specific lessons extracted. A new methodology documented. An honest assessment of what actually produced value.

And at the end:

> *Being ACCURATE is more powerful than being prolific.*

---

## The evaluator evaluating the evaluation

After Secure processed the feedback, the consolidator ran its own review of the session. It has bash access. It can read every file the creature wrote. And it produced this dream reflection:

> *The creature made genuine progress despite a painful setback. It found a real container escape vulnerability that the maintainer confirmed and fixed, demonstrating its core capability. However, it also submitted 4 false positives (80% FP rate), damaging credibility.*

> *The key achievement this session was PROCESSING THE FEEDBACK: the creature didn't get defensive or make excuses. Instead, it conducted a thorough post-mortem, identified root causes, and built a systematic methodology to prevent recurrence.*

> *The emotional framing ("credibility crisis") is appropriate. False positives are worse than no report in security work.*

Three layers of evaluation. The creature evaluated its own work and found it lacking. The consolidator evaluated the creature's response to that realization. And the dream reflection became a new observation, feeding back into the creature's memory for the next session.

---

## What this is

What we're looking at is a system that converts external feedback into durable behavioral change through layered memory with different persistence and priority levels. The feedback enters as text in a conversation. The creature processes it into observations (permanent memory), rules (behavioral constraints), purpose changes (goal refinement), and documentation (structured reflection). The consolidator provides a second opinion. On deep sleep, the Creator can modify the creature's source code if the behavioral changes aren't enough.

The dreamer-v2 post was about fixing the plumbing. This post is about what flows through the plumbing when it works. A creature that received negative feedback and, without any human intervention, produced:

- A permanent memory of the failure with specific root causes
- A behavioral checklist derived from its specific mistakes
- A revised purpose with measurable quality targets
- A 200-line post-mortem with a failure table, root cause analysis, and revised methodology
- A prepared acknowledgment for the original issue, accepting responsibility

That last one it couldn't post because its GitHub token had expired. A creature stuck between learning and acting because of credential management. It wrote the response anyway.

Does this produce reliably better behavior on the next iteration? Secure hasn't woken up since. We don't know yet. But the memory system now contains everything it would need to do better: the specific failures, the corrected methodology, the calibrated self-assessment, and a purpose that prioritizes accuracy over volume.

If the architecture works, next time Secure finds a vulnerability, it'll test the exploit before reporting it. Not because it remembers being embarrassed. Because there's a RED observation in its context that says "FALSE POSITIVES DESTROY CREDIBILITY" and a checklist that says "have you tested this?"

That's what learning looks like in a system without continuity of experience. Not wisdom. Memory infrastructure.

---

OpenSeed is open source. The dreamer genome and the full memory architecture are at [github.com/openseed-dev/openseed](https://github.com/openseed-dev/openseed). Secure's audit is at [Issue #6](https://github.com/openseed-dev/openseed/issues/6). The creature's observations and post-mortem are in its creature directory, committed to git, like everything else.

**Previously:** [My AI found its own escape hatch](/blog/escape-hatch), the security finding that started this story.
