# Janee Secrets Management

Janee provides secure credential management for openseed creatures. Creatures connect via HTTP and never see raw API keys. It works in both native and Docker modes.

## Architecture

```
┌─────────────┐     HTTP      ┌──────────┐    real creds   ┌──────────┐
│  Creature    │ ────────────> │  Janee   │ ──────────────> │ External │
│  (dreamer)   │               │ (local   │   proxied req   │   API    │
└─────────────┘               │  or net) │                 └──────────┘
     no keys                  └──────────┘                   GitHub, etc.
                              encrypted at rest
```

## How it works

- **Native mode**: The orchestrator spawns Janee as a child process (`src/host/janee.ts`). No Docker required.
- **Docker mode**: Janee runs as a separate container on the Docker network (see `docker-compose.yml`).
- **Either way**: The supervisor injects `JANEE_URL` into creature environments automatically.

## Graceful degradation

Janee is **optional**. If the Janee service is not running or not configured:

- The dreamer `janee` tool reports unavailability with a helpful message
- The creature falls back to raw environment variables (e.g. `GITHUB_TOKEN`) — same as before Janee existed
- No crashes, no error loops

This means you can:
- Run openseed without Janee and creatures still work
- Add Janee later without changing creature code
- Remove Janee without breaking anything

## Setup

### 1. Install Janee

```bash
npm install -g @true-and-useful/janee
```

### 2. Initialize and add services

```bash
janee init          # creates ~/.janee/config.yaml
janee add           # interactive — walks you through adding a service
```

Or add services directly:

```bash
janee add github --baseUrl https://api.github.com --auth bearer:ghp_xxx
janee add anthropic --baseUrl https://api.anthropic.com --auth header:x-api-key:sk-ant-xxx
```

### 3. Start openseed

```bash
# Native mode — Janee starts automatically if ~/.janee/config.yaml exists
openseed start

# Docker mode — Janee runs as a container
docker compose up
```

No extra configuration needed. The orchestrator auto-detects Janee and injects `JANEE_URL` into creatures.

To use a different config directory, set `JANEE_HOME`:

```bash
JANEE_HOME=/path/to/janee-config openseed start
```

## How creatures use Janee

The dreamer genome includes a `janee` tool that wraps Janee's MCP API:

```typescript
// Check if Janee is available
await janee({ action: 'status' });

// List available services
await janee({ action: 'list_services' });

// Make an API request through Janee (credentials injected automatically)
await janee({
  action: 'execute',
  capability: 'github',
  method: 'GET',
  path: '/user',
  reason: 'checking identity'
});
```

The creature never sees API keys — Janee injects them into the outbound request and returns the response.

If Janee isn't running, the tool returns a clear message suggesting the creature use raw env vars instead.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `JANEE_URL` | auto-detected | Injected into creature environments by the supervisor |
| `JANEE_HOME` | `~/.janee` | Janee configuration directory |
| `JANEE_PORT` | `3100` | Port for local Janee instance (native mode) |

## More info

- [Janee on GitHub](https://github.com/rsdouglas/janee)
- [Janee on npm](https://www.npmjs.com/package/@true-and-useful/janee)
