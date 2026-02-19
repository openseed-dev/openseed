# LATS Genome

**Inspiration:** "Language Agent Tree Search Unifies Reasoning Acting and Planning in Language Agents" (Zhou et al., 2023)

## Core Idea

Dreamer thinks linearly. LATS thinks in trees. Instead of a single conversation thread, maintain a tree of action sequences with backtracking, value-guided exploration, and state snapshots. Git gives us the undo mechanism for free.

## Architecture

### Tree Search over Actions
- Instead of a single conversation thread, maintain a tree of action sequences
- Each node is a state (filesystem snapshot via git), each edge is an action
- Explores multiple approaches to a problem, not just the first one that comes to mind

### Backtracking
- When a path fails or scores poorly, backtrack to a promising earlier node and try a different approach
- Dreamer can't do this — it only moves forward
- Use `git branch` to checkpoint and `git checkout` to backtrack
- The tree structure lives on disk (`.self/tree.json` or a directory of branches)

### Value Function
- Each node gets a score via LLM self-evaluation ("how promising is this state?")
- Guides which branches to explore next — best-first search, not depth-first
- Scores consider: progress toward goal, code quality, remaining uncertainty

### State Snapshots
- Git branches as real checkpoints — not just conversation state, but actual filesystem state
- Can diff between branches to understand what each path tried
- Merge successful sub-trees back into main

## Cognitive Loop

```
define goal → create root node
  → expand: generate candidate actions → score each
  → select: pick highest-value unexplored node
  → execute: take action, observe result
  → evaluate: score new state
  → if dead end: backtrack to best unexplored node
  → if goal reached: merge branch to main
```

## Why It Fits OpenSeed

- Git already provides the branching/checkpoint infrastructure
- Fundamentally different reasoning strategy — breadth vs. dreamer's depth
- Observable: the branch tree is a visible artifact of the creature's thinking process
- Could solve problems dreamer gets stuck on (looping on one approach without trying alternatives)

## TODO

- [ ] Define `genome.json` schema
- [ ] Design tree node format (state representation, score, parent, children, actions taken)
- [ ] Design branching strategy (when to branch, how many candidates per expansion)
- [ ] Design value/scoring heuristic (LLM self-eval prompt)
- [ ] Implement core tree search loop (expand → select → execute → evaluate → backtrack)
- [ ] Implement git-based state management (branch, checkout, merge)
- [ ] Handle context management across branches (what does the creature "remember" after backtracking?)
- [ ] Define termination criteria (goal reached, budget exhausted, tree depth limit)
- [ ] System prompt: establish identity as a deliberate explorer, not a linear thinker
- [ ] Dashboard tabs: tree visualization, branch scores, current path, backtrack history
