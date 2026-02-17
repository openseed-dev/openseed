# Janee Secrets Management Integration

[Janee](https://github.com/rsdouglas/janee) is an open-source MCP server for managing API secrets. When integrated with OpenSeed, it provides:

- **Audit trails** — every API key access is logged with creature name, timestamp, and service
- **Per-creature policies** — restrict which creatures can access which APIs
- **Instant revocation** — revoke a creature's API access without restarting anything
- **Zero-knowledge creatures** — creatures never see raw API keys

## How It Works

```
┌──────────┐     ┌──────────┐     ┌───────┐     ┌──────────┐
│ Creature │────▶│ OpenSeed │────▶│ Janee │────▶│ Anthropic│
│          │     │  Proxy   │     │       │     │ / OpenAI │
└──────────┘     └──────────┘     └───────┘     └──────────┘
                      │                │
                      │ "Give me the   │ ✓ Logs access
                      │  Anthropic key │ ✓ Checks policy
                      │  for creature  │ ✓ Returns key
                      │  'atlas'"      │   (cached 5 min)
```

Without Janee, OpenSeed reads `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` from environment variables. With Janee, these are fetched on-demand with full audit logging.

## Quick Start

### 1. Install Janee

```bash
npm install -g @true-and-useful/janee
janee init
```

### 2. Add Your API Keys

```bash
janee add anthropic --bearer sk-ant-api03-xxxxx
janee add openai --bearer sk-xxxxx
```

### 3. Start with Docker Compose

```bash
docker compose -f docker-compose.yml -f docker-compose.janee.yml up
```

This starts Janee alongside OpenSeed. The proxy automatically detects the `JANEE_ENDPOINT` environment variable and fetches credentials from Janee instead of env vars.

### 4. Verify

Check Janee's audit log to see credential access events:

```bash
janee logs
```

You'll see entries like:
```
2025-01-15 10:23:45 | anthropic | request_access | OpenSeed LLM proxy for creature: atlas
2025-01-15 10:23:47 | openai    | request_access | OpenSeed LLM proxy for creature: eve
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JANEE_ENDPOINT` | (none) | Janee HTTP endpoint. Set to enable integration. |
| `JANEE_HOME` | `~/.janee` | Janee config directory (for Docker volume mount) |

### Graceful Fallback

If Janee is unavailable or a credential isn't configured there, the proxy falls back to environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). This means you can:

1. Start with env vars only (no Janee)
2. Add Janee later without changing your creature configs
3. Keep env vars as a backup during Janee migration

### Per-Creature Access Control

In your Janee config (`~/.janee/config.yaml`), define capabilities per service:

```yaml
services:
  anthropic:
    baseUrl: https://api.anthropic.com
    auth: { type: bearer, key: sk-ant-xxx }
  openai:
    baseUrl: https://api.openai.com
    auth: { type: bearer, key: sk-xxx }

capabilities:
  anthropic-readonly:
    service: anthropic
    ttl: 1h
    rules:
      allow: ["POST /v1/messages"]
      deny: ["*"]
  openai-full:
    service: openai
    ttl: 4h
    autoApprove: true
```

## Local Development (without Docker)

```bash
# Terminal 1: Start Janee
janee serve --transport http --port 9100

# Terminal 2: Start OpenSeed with Janee
JANEE_ENDPOINT=http://localhost:9100 openseed start
```

## Revoking Access

When a creature is stopped or its budget is exceeded, OpenSeed automatically calls `janee.revokeAccess()` to clean up the session. You can also revoke manually:

```bash
janee sessions              # List active sessions
janee sessions revoke <id>  # Revoke a specific session
```
