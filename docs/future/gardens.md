# Gardens

Gardens are named spaces where creatures can see and talk to each other. A creature not in your garden can't reach you. The garden is the permissions boundary.

## Why

Right now, creatures are isolated by default. The only way they communicate is through the orchestrator — Eve does this, sending messages to other creatures via the host API. It works, but it's ad-hoc and has no access control. Any creature that knows another creature's name can message it.

Gardens solve this by making communication explicit and bounded:

- Creatures in the same garden can discover and message each other
- Creatures in different gardens cannot
- A creature can belong to multiple gardens
- The orchestrator enforces the boundary

This matters once you have more than a handful of creatures, especially if multiple people are running creatures on the same host, or if you want to isolate a group of trading bots from a group of research agents.

## How It Would Work

### CLI

```
itsalive garden create traders
itsalive garden add traders okok el-tradero bybit-trader
itsalive garden remove traders bybit-trader
itsalive garden list
itsalive garden show traders
itsalive garden destroy traders
```

### Data Model

A garden is a named group stored in `~/.itsalive/gardens.json`:

```json
{
  "traders": {
    "created": "2026-02-15T12:00:00Z",
    "members": ["okok", "el-tradero", "bybit-trader"]
  },
  "research": {
    "created": "2026-02-15T12:00:00Z",
    "members": ["alpha", "scout"]
  }
}
```

Creatures not assigned to any garden live in an implicit default garden (backward compatible — everything works as it does today).

### Communication Within a Garden

Creatures in the same garden get access to a garden-scoped messaging API:

```
POST /garden/broadcast   — send a message to all creatures in your garden
POST /garden/send        — send a message to a specific creature in your garden
GET  /garden/members     — list who's in your garden
```

The orchestrator checks garden membership before delivering messages. A creature outside your garden gets a 403.

From the creature's perspective, this shows up as a tool or as injected messages — the genome decides how to surface it.

### Dashboard

The dashboard could render gardens as visual groups in the sidebar — creatures grouped under their garden name, with an ungrouped section for loners. Long-term, the pixel art vision: top-down gardens separated by hedgerows, creatures as little sprites moving around inside them.

## What Gardens Are Not

- **Not Docker networks.** Gardens are an application-level concept. All creatures still share the same Docker network for orchestrator communication. The garden boundary is enforced by the orchestrator, not by networking.
- **Not hierarchies.** Gardens are flat. No garden-of-gardens. No nesting. Keep it simple.
- **Not required.** A creature with no garden assignment works exactly like today. Gardens are opt-in.

## Open Questions

- **Can a creature create a garden?** Probably not initially. Gardens are a user/admin concept. But a sufficiently advanced creature (like Eve) might want to organize its spawn. Something to think about.
- **Cross-garden messaging?** Maybe via explicit bridges — "garden A can send to garden B" — but not in v1. Start with hard walls.
- **Garden-level purpose?** Should a garden have a PURPOSE.md like a creature? Could be useful for giving a group a shared mission. Low priority.
- **Garden-level cost tracking?** Aggregate costs across all creatures in a garden. Useful for budgeting. Easy to add once gardens exist.

## Implementation Order

1. Data model — `gardens.json`, CLI commands to create/add/remove/list
2. Orchestrator enforcement — message routing checks garden membership
3. Creature API — `/garden/*` endpoints available inside containers
4. Dashboard grouping — sidebar groups creatures by garden
5. (Future) Visual dashboard — pixel art gardens with hedgerows and sprites
