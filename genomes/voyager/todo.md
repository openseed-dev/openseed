# Voyager Genome

**Codename:** forager
**Inspiration:** "Voyager: An Open-Ended Embodied Agent with Large Language Models" (Wang et al., 2023)

## Core Idea

Where dreamer learns **observations and rules**, voyager learns **skills**. The creature accumulates a library of verified, reusable code functions on disk. Its identity isn't shaped by memories, but by capabilities.

## Architecture

### Skill Library
- Instead of `.self/observations.md` and `.self/rules.md`, the creature maintains a `skills/` directory of verified, reusable scripts
- Each skill is self-contained, tested, and confirmed to work before being committed
- Skills are indexed for retrieval (embedding similarity or keyword match)
- Git-tracked — the log becomes a record of *capability accumulation*

### Automatic Curriculum
- The creature self-proposes tasks of increasing difficulty based on what it's already mastered
- Maintains a `frontier.md` or structured queue of self-proposed challenges
- No static purpose statement — a living frontier of capability

### Skill Retrieval & Composition
- When facing a new task, retrieve the most relevant existing skills
- Compose them into a solution rather than starting from scratch
- Builds on its own prior work

### Verification Gate
- Skills only graduate to the library after passing validation (code runs, output is correct)
- The creature already has bash — it can run and test its own code
- Failed attempts inform the next try but don't pollute the library

## Cognitive Loop

```
propose task → retrieve relevant skills → attempt → verify
  → if success: commit skill to library → propose harder task
  → if failure: reflect on why → retry with reflection
```

No sleep/dream cycle — the rhythm is task-completion cycles.

## Why It Fits OpenSeed

- Skill library = files on disk, version-controlled in git
- Verification = bash execution already available
- Maximally different from dreamer — two genuinely distinct cognitive strategies
- A voyager creature's skill library could be *imported* by a dreamer creature (cross-genome knowledge transfer)

## TODO

- [ ] Define `genome.json` schema
- [ ] Design skill file format (metadata, code, verification criteria)
- [ ] Design curriculum/frontier data structure
- [ ] Design skill retrieval mechanism (simple keyword? embeddings?)
- [ ] Implement core cognitive loop (propose → retrieve → attempt → verify → commit)
- [ ] Implement skill indexing and retrieval
- [ ] System prompt: establish identity as a capability-builder, not a memory-keeper
- [ ] Define what replaces sleep/dreams (task-completion cycles? periodic frontier review?)
- [ ] Dashboard tabs: skill library, frontier, attempt history
