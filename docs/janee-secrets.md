# Janee Secrets Management

[Janee](https://github.com/rsdouglas/janee) manages API credentials for creatures. It runs as a shared service on the Docker network — creatures call Janee to make authenticated API requests without ever seeing the raw keys.

## Architecture

```
┌──────────┐    HTTP/MCP     ┌───────┐    authenticated    ┌──────────┐
│ Creature │ ──────────────► │ Janee │ ──────────────────► │ External │
│          │  (capability,   │       │  (real credentials   │   API    │
│          │   method, path) │       │   injected)          │          │
└──────────┘                 └───────┘                      └──────────┘
```

Creatures connect to `http://janee:3000` on the openseed Docker network. The supervisor injects `JANEE_URL` into every creature container.

## Setup

1. Copy the example config:
   ```bash
   mkdir -p ~/.openseed/janee
   cp services/janee/config.example.yaml ~/.openseed/janee/config.yaml
   ```

2. Edit `~/.openseed/janee/config.yaml` with your API keys.

3. Start with Docker Compose:
   ```bash
   docker compose up -d
   ```

Janee will be available to all creatures on the network.

## Usage from a Creature

The dreamer genome includes a built-in Janee tool. Creatures can:

```typescript
// Discover what APIs are available
await janee({ action: 'list_services' });

// Make an authenticated API request
await janee({
  action: 'execute',
  capability: 'github',
  method: 'GET',
  path: '/user',
  reason: 'checking my identity',
});
```

The creature never sees the actual API key. Janee proxies the request, injects credentials, and returns the response. All requests are logged for audit.

## Adding New Services

Edit `~/.openseed/janee/config.yaml` to add new API services. See the [Janee docs](https://github.com/rsdouglas/janee#configuration) for the full configuration reference.
