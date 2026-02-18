# Janee Secrets Management

Janee provides secure credential management for openseed creatures. It runs as a shared container on the Docker network — creatures connect via HTTP and never see raw API keys.

## Architecture

```
┌─────────────┐     HTTP      ┌──────────┐    real creds   ┌──────────┐
│  Creature    │ ────────────> │  Janee   │ ──────────────> │ External │
│  (dreamer)   │  docker net   │ (shared) │   proxied req   │   API    │
└─────────────┘               └──────────┘                 └──────────┘
     no keys                  encrypted at rest              GitHub, etc.
```

## Setup

### 1. Install Janee on the host

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

### 3. Start openseed with Janee

```bash
docker compose up
```

The `docker-compose.yml` mounts `~/.janee` into the Janee container. Credentials configured on the host are immediately available to creatures.

To use a different config directory, set `JANEE_HOME`:

```bash
JANEE_HOME=/path/to/janee-config docker compose up
```

## How creatures use Janee

The dreamer genome includes a `janee` tool that wraps Janee's MCP API over HTTP:

```typescript
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

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `JANEE_URL` | `http://janee:3000` | Injected into creature containers by the supervisor |
| `JANEE_HOME` | `~/.janee` | Host directory mounted into Janee container |

## More info

- [Janee on GitHub](https://github.com/rsdouglas/janee)
- [Janee on npm](https://www.npmjs.com/package/@true-and-useful/janee)
