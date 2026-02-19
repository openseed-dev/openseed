# SOAR Genome

**Inspiration:** Laird, Newell & Rosenbloom's SOAR cognitive architecture (decades of research at University of Michigan)

## Core Idea

The most architecturally different from dreamer. Instead of a flat purpose and free-form exploration, SOAR maintains an explicit goal hierarchy with impasse detection and automatic chunking. Over time, complex multi-step solutions compile into single-step reflexes.

## Architecture

### Hierarchical Goal Decomposition
- Instead of a flat purpose, maintain an explicit goal stack
- Goals spawn subgoals, subgoals spawn sub-subgoals
- Stored as a `goals/` directory tree mirroring the hierarchy
- Progress is tracked at every level

### Impasse Detection
- When the creature can't make progress on a goal, it detects the *impasse* (no applicable operator, tie between operators, failure of an operator)
- The impasse automatically creates a subgoal to resolve it (learn a new skill, gather info, try a different approach)
- This is the learning trigger — impasses drive all learning

### Chunking (Production Compilation)
- When a subgoal is resolved, the solution is compiled into a "chunk" — an if-then production rule
- Stored in `chunks/` directory as simple condition → action mappings
- Next time the same situation arises, the chunk fires automatically (injected into context)
- Over time, complex multi-step solutions become single-step reflexes
- This is fundamentally different from dreamer's rules (which are behavioral guidelines, not compiled solutions)

### Working Memory vs. Long-Term Memory
- Working memory: current goal stack, active context, recent results
- Long-term memory: chunks (procedural), facts (declarative), with activation-based retrieval
- Frequently accessed memories are easier to recall (higher activation = injected into context more readily)

## Cognitive Loop

```
select goal from stack → match applicable chunks/operators
  → if one applies: execute it → update state → check goal completion
  → if none apply (impasse): create subgoal to resolve impasse
  → if multiple apply (tie): create subgoal to decide
  → when subgoal resolved: compile chunk → pop goal stack → continue
```

## Why It Fits OpenSeed

- Most structured of all the alternatives — explicit goal management vs. dreamer's open-ended exploration
- Chunking is a unique persistence mechanism — the creature literally gets faster at things it's done before
- Well-studied architecture with decades of cognitive science research behind it
- Natural fit for creatures with complex, decomposable objectives
- The goal tree is a powerful observable artifact for the dashboard

## TODO

- [ ] Define `genome.json` schema
- [ ] Design goal representation (conditions, operators, success criteria, parent/children)
- [ ] Design chunk format (condition pattern → action sequence, activation score)
- [ ] Design impasse detection (how does the creature know it's stuck?)
- [ ] Implement goal stack management (push, pop, decompose)
- [ ] Implement chunk storage, retrieval, and activation decay
- [ ] Implement impasse → subgoal creation logic
- [ ] Implement chunk compilation (subgoal resolution → production rule)
- [ ] System prompt: establish identity as a systematic problem-decomposer
- [ ] Dashboard tabs: goal tree, chunk library, impasse log, activation heatmap
