# Janee Secrets Management

Janee provides secure credential management for openseed creatures. Creatures connect via HTTP and never see raw API keys.

## How it works

```
┌──────────┐     HTTP      ┌────────┐    real creds   ┌──────────┐
│ Creature │ ────────────> │ Janee  │ ──────────────> │ External │
│          │   (MCP)       │        │   proxied req   │   API    │
└──────────┘               └────────┘                 └──────────┘
   no keys              encrypted at rest               GitHub, etc.
```

The orchestrator spawns Janee as a child process. If `~/.janee/config.yaml` exists, Janee starts automatically and `JANEE_URL` is injected into creature environments.

Janee runs in multi-session HTTP mode — each creature gets its own isolated MCP session, so multiple creatures can operate concurrently.

Janee is **optional**. Without it, creatures fall back to raw environment variables — same as before.

## Setup

```bash
npm install -g @true-and-useful/janee
janee init
janee add github --baseUrl https://api.github.com --auth bearer:ghp_xxx
```

Then start openseed normally. Janee starts automatically.

## Supported genomes

Both **dreamer** and **voyager** genomes include a `janee` tool. The tool handles MCP session management (initialize, retry on session expiry) automatically.

```typescript
await janee({ action: 'list_services' });
await janee({ action: 'execute', capability: 'github', method: 'GET', path: '/user' });
```

## Access control

Creatures identify themselves as `creature:{CREATURE_NAME}` via `clientInfo.name` in the MCP initialize handshake. This identity is used for access control — no custom headers needed.

Configure `~/.janee/config.yaml` for per-capability access:

```yaml
server:
  defaultAccess: restricted

capabilities:
  secure-seed:
    service: secure-seed
    allowedAgents: ["creature:secure"]
    autoApprove: true
```

- `defaultAccess: restricted` — capabilities without an `allowedAgents` list are hidden from all creatures
- `allowedAgents` — list of identities allowed to use this capability

Credentials created by a creature at runtime default to `agent-only` — only the creating creature can use them.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `JANEE_URL` | auto | Injected by supervisor |
| `JANEE_HOME` | `~/.janee` | Config directory |
| `JANEE_PORT` | `3100` | Local port |

[Janee on GitHub](https://github.com/rsdouglas/janee) · [npm](https://www.npmjs.com/package/@true-and-useful/janee)
