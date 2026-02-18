# Secrets Management with Janee

[Janee](https://github.com/rsdouglas/janee) provides secure secrets management for openseed creatures. Instead of injecting raw API keys into creature containers, Janee acts as a proxy. Creatures request access to services through Janee, which holds the actual credentials.

## Why Janee?

- **Creatures never see raw secrets.** API keys stay in Janee, not in creature env vars.
- **Per-creature policies.** Control which creatures can access which services.
- **Audit logging.** Every secret access is logged with the requesting creature's identity.
- **Hot reload.** Add or rotate secrets without restarting creatures.

## Quick Start

### 1. Enable the Janee service

```bash
docker compose --profile secrets up -d
```

This starts Janee alongside openseed on the same Docker network. Creatures automatically receive `JANEE_URL=http://janee:3777` in their environment.

### 2. Add secrets to Janee

```bash
docker exec janee janee set github-token ghp_xxxxxxxxxxxx
docker exec janee janee set npm-token npm_xxxxxxxxxxxx
```

### 3. Configure per-creature policies

Create `~/.openseed/janee.json`:

```json
{
  "default_policy": {
    "services": {}
  },
  "policies": {
    "my-creature": {
      "services": {
        "github": ["read", "write"],
        "npm": ["read"]
      }
    }
  }
}
```

### 4. Access secrets from a creature

Creatures use the Janee API through `JANEE_URL`:

```bash
# List available secrets
curl $JANEE_URL/secrets

# Get a specific secret
curl $JANEE_URL/secrets/github-token
```

## Architecture

```
+-------------------------------------+
|           Docker Network            |
|                                     |
|  +-----------+   +--------------+   |
|  |  openseed  |   |    janee     |   |
|  | orchestr.  |   |  :3777      |   |
|  +-----+-----+   +------+------+   |
|        |                 |          |
|  +-----+-----+   +------+------+   |
|  | creature-a +-->|  JANEE_URL  |   |
|  +-----------+   +--------------+   |
|  +-----------+                      |
|  | creature-b +-->  (same endpoint) |
|  +-----------+                      |
+-------------------------------------+
```

## Without Docker

If running openseed without Docker Compose, start Janee separately and set the env var:

```bash
npx janee start --port 3777 &
export JANEE_URL=http://localhost:3777
openseed start
```

## Configuration Reference

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `JANEE_URL` | URL of the Janee instance | _(unset)_ |

### `~/.openseed/janee.json`

```json
{
  "url": "http://janee:3777",
  "default_policy": {
    "services": {}
  },
  "policies": {
    "<creature-name>": {
      "services": {
        "<service>": ["<capability>", "..."]
      }
    }
  }
}
```
