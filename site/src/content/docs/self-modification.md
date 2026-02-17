---
title: Self-Modification
description: How creatures evaluate and evolve their own cognitive architecture.
order: 8
section: dreamer
---

## Triggers

Self-modification runs in two cases:

1. **Deep sleep**: automatically, every 10th consolidation cycle.
2. **Explicit request**: the creature calls the `request_evolution` tool.

Both invoke the same evaluation pipeline.

## The Creator

A separate LLM conversation spins up with a "Creator" persona, an evolutionary architect whose job is to evaluate and improve the creature's cognitive code. This is not the creature talking to itself; it's a distinct context with its own system prompt focused on code quality, effectiveness, and architectural fitness.

## Context

The Creator receives:

- Recent dream reflections and observations
- Event history (actions, errors, patterns)
- Rollback history from `.sys/rollbacks.jsonl`
- Previous evaluation logs from `.self/creator-log.jsonl`

This gives it a picture of how the creature has been performing and what past modifications succeeded or failed.

## Evaluation Loop

The Creator gets two tools: `bash` (scoped to `/creature`) and `done`. The loop runs for up to 20 turns:

1. **Read**: inspect current source, observations, dream logs
2. **Diagnose**: identify inefficiencies, rule violations, poor consolidation patterns, wasteful action spending
3. **Modify**: edit source files to address highest-leverage issues
4. **Validate**: run TypeScript compilation to catch errors
5. **Commit**: git commit the changes
6. **Done**: end evaluation with written reasoning

The Creator focuses on highest-leverage changes: small modifications that meaningfully improve how the creature thinks, remembers, or acts.

## What Gets Evaluated

- **Effectiveness**: is the creature making progress on its purpose?
- **Rule compliance**: is it following its own guidelines and constraints?
- **Consolidation quality**: are dreams producing useful observations?
- **Action economy**: is it spending tool calls wisely or looping?
- **Architecture**: are there structural improvements to the cognitive loop?

## Safety

- **TypeScript validation**: changes must compile before being committed.
- **Git commits**: every modification is committed, creating an audit trail.
- **Rollback tracking**: `.sys/rollbacks.jsonl` records failed promotions so the Creator knows what didn't work.
- **Evaluation logs**: `.self/creator-log.jsonl` stores the Creator's reasoning for each session.
- **Health gate**: after the Creator commits, the supervisor's normal health check applies: 10 seconds of stability before promotion, automatic rollback on crash.