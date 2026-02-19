# Reflexion Genome

**Inspiration:** "Reflexion: Language Agents with Verbal Reinforcement Learning" (Shinn et al., 2023)

## Core Idea

Where dreamer consolidates during sleep, reflexion reflects **immediately after failure**. The creature is driven by a tight trial-evaluate-reflect loop with a persistent buffer of verbal self-critiques. It doesn't wander — it iterates.

## Architecture

### Trial-Evaluate-Reflect Loop
- Attempt a task → evaluate outcome (did it work?) → if not, write a natural-language reflection about *why* it failed → retry with the reflection injected into context
- The evaluation is explicit and binary: success or failure, with a reason

### Persistent Reflection Buffer
- A capped list of verbal self-critiques that persists across attempts
- Stored on disk (`.self/reflections.jsonl` or similar)
- This is the creature's "experience" — not observations about the world, but lessons about its own failure modes
- Older reflections get summarized/pruned to stay within context limits

### Explicit Success/Failure Signal
- Unlike dreamer which consolidates regardless of outcome, reflexion is driven by a binary evaluator
- The creature must define what "success" looks like before each attempt
- Self-evaluation or external signal (test passing, output matching, etc.)

## Cognitive Loop

```
define task + success criteria → attempt → evaluate
  → if success: log win, move on
  → if failure: write reflection (why did it fail?) → inject reflection → retry
  → after N failures: escalate (redefine task, break it down, or abandon)
```

## Why It Fits OpenSeed

- Laser-focused on task completion through iterative self-correction
- Good for creatures with concrete, measurable goals
- Simple to implement — small surface area compared to dreamer
- The reflection buffer is a novel persistent memory structure distinct from dreamer's observations/rules/dreams
- Natural fit for creatures doing engineering work (tests as evaluators)

## TODO

- [ ] Define `genome.json` schema
- [ ] Design reflection format (what gets stored per failed attempt)
- [ ] Design evaluation mechanism (how does the creature judge success/failure?)
- [ ] Implement core trial-evaluate-reflect loop
- [ ] Implement reflection buffer with pruning/summarization
- [ ] Define retry limits and escalation strategy
- [ ] System prompt: establish identity as an iterative problem-solver
- [ ] Dashboard tabs: current task, attempt history, reflection buffer, success rate
