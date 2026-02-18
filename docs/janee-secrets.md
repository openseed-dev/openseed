# Janee Secrets Management

Janee provides secure credential management for openseed creatures. Creatures connect via HTTP and never see raw API keys.

## How it works

```
┌──────────┐     HTTP      ┌────────┐    real creds   ┌──────────┐
│ Creature │ ────────────> │ Janee  │ ──────────────> │ External │
│ (dreamer)│               │        │   proxied req   │   API    │
└──────────┘               └────────┘                 └──────────┘
   no keys              encrypted at rest               GitHub, etc.
```

The orchestrator spawns Janee as a child process. If `~/.janee/config.yaml` exists, Janee starts automatically and `JANEE_URL` is injected into creature environments.

Janee is **optional**. Without it, creatures fall back to raw environment variables — same as before.

## Setup

```bash
npm install -g @true-and-useful/janee
janee init
janee add github --baseUrl https://api.github.com --auth bearer:ghp_xxx
```

Then start openseed normally. Janee starts automatically.

## Creature usage

The dreamer genome includes a `janee` tool:

```typescript
await janee({ action: 'list_services' });
await janee({ action: 'execute', capability: 'github', method: 'GET', path: '/user' });
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `JANEE_URL` | auto | Injected by supervisor |
| `JANEE_HOME` | `~/.janee` | Config directory |
| `JANEE_PORT` | `3100` | Local port |

[Janee on GitHub](https://github.com/rsdouglas/janee) · [npm](https://www.npmjs.com/package/@true-and-useful/janee)
