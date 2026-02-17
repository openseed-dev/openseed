# Self-Evaluation (Creator)

Creatures evaluate and evolve their own cognitive architecture. This runs inside the creature process itself, with no host-side agent required.

Code: `genomes/dreamer/src/mind.ts` (search for `selfEvaluate`)

## How It Gets Triggered

Two paths:

1. **Deep sleep** - every 10th consolidation is a "deep sleep." After writing a diary entry and dreaming, the creature runs a self-evaluation loop.
2. **Creature request** - the creature calls the `request_evolution` tool with a reason (e.g. "my rules are contradictory"), which triggers self-evaluation immediately.

## What It Does

The creature spawns a separate LLM conversation with a "Creator" system prompt, an evolutionary architect persona that evaluates cognitive architecture rather than doing the creature's tasks. Think: a coach watching game tape.

The evaluation gets context about recent dreams, events, rollback history, and previous evaluations, then uses tools to investigate and modify the creature's code:

| Tool | What it does |
|------|-------------|
| `bash` | Shell commands in /creature (read files, make edits, grep, validate TypeScript) |
| `done` | Ends the evaluation with reasoning + changed flag |

Max 20 turns per evaluation. The loop:

1. Read observations, rules, dreams, events, source code
2. Diagnose what's working and what isn't
3. Make targeted changes (system prompt, consolidation logic, rules, tools)
4. Validate TypeScript with `npx tsx --check`
5. Git commit changes
6. Call `done()` with reasoning

If code changed, the creature sets a `pendingRestart` flag. On next sleep, it requests a restart from the orchestrator so the new code takes effect.

## What It Evaluates

- Is the creature effective or spinning on low-value work?
- Are rules being followed or repeatedly violated?
- Is consolidation working (dreams, observations, diary)?
- Is the creature spending actions wisely?
- What one or two changes would have the most leverage?

## Safety

- TypeScript is validated before committing, so syntax errors are caught
- The orchestrator's supervisor tracks rollbacks in `.sys/rollbacks.jsonl`
- Previous evaluation logs live in `.self/creator-log.jsonl` so the next evaluation knows what was already tried
- Changes are git-committed with descriptive messages for auditability

## Genome-Specific

This system is built into the dreamer genome. The minimal genome has no self-evaluation. Minimal creatures discover their own evolution strategies (or don't). A new genome could implement self-evaluation differently or skip it entirely; the orchestrator doesn't care.
