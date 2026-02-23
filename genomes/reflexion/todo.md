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

## Prior Art

The pattern is well-established, not novel in isolation.

**The paper:** Shinn et al., NeurIPS 2023. Tested on HumanEval (coding, 91% pass@1 vs GPT-4's 80%), HotPotQA (reasoning), AlfWorld (decision-making). The key insight is simple: after failure, have the LLM write a verbal self-critique, persist it, inject into next attempt.

**Existing implementations:**
- [noahshinn/reflexion](https://github.com/noahshinn/reflexion) — official repo, 3k+ stars, Python, MIT. Benchmark-oriented, not a general agent framework.
- [LangGraph](https://langchain-ai.github.io/langgraph/tutorials/reflexion/reflexion/) — first-class tutorial/pattern, `langgraph-reflection` package productionizes the loop.
- [becklabs/reflexion-framework](https://github.com/becklabs/reflexion-framework) — modular framework for text-based Reflexion agents.

**Where it's evolved:**
- **ReflAct** (2025) extends it by grounding reflection in goal-state alignment, not just "what went wrong." 93.3% on ALFWorld, +27.7% over ReAct.
- **Reflection-Driven Control** (Dec 2025) uses it for security/trust in code agents — reflection loop detects risky patterns, injects repair guidelines.
- Most modern agent frameworks use some form of retry-with-context internally (Devin, Cursor agent, etc.), though not always explicitly calling it "Reflexion."

**What's actually novel here:** All existing implementations are single-task, single-session, benchmark-oriented. Nobody's built a persistent, long-running autonomous agent with a reflection buffer that accumulates across hundreds of tasks over days/weeks. The contribution isn't "we implemented Reflexion" — it's "we tested whether failure-driven self-correction compounds over time in an autonomous agent."

## Why It Fits OpenSeed

- Laser-focused on task completion through iterative self-correction
- Good for creatures with concrete, measurable goals
- Simple to implement — small surface area compared to dreamer
- Natural fit for creatures doing engineering work (tests as evaluators)
- Best candidate for a staff engineer genome (Voyager experiment showed foraging loops are wrong for judgment work; Reflexion's failure-driven learning maps directly to code review, test feedback, PR pushback)
- Could layer inside Dreamer's fatigue/consolidation system as a hybrid

## TODO

- [ ] Define `genome.json` schema
- [ ] Design reflection format (what gets stored per failed attempt)
- [ ] Design evaluation mechanism (how does the creature judge success/failure?)
- [ ] Implement core trial-evaluate-reflect loop
- [ ] Implement reflection buffer with pruning/summarization
- [ ] Define retry limits and escalation strategy
- [ ] System prompt: establish identity as an iterative problem-solver
- [ ] Dashboard tabs: current task, attempt history, reflection buffer, success rate
