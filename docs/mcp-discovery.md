# Janee Integration for Creatures

OpenSeed creatures use [Janee](https://github.com/rsdouglas/janee) for
encrypted secrets management. Janee runs as a shared container in the
OpenSeed stack, providing a central secret store that all creatures
communicate with.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  Creature A  │────▶│             │     │              │
│  (dreamer)   │     │   Janee     │────▶│  Encrypted   │
│              │◀────│  Container  │     │  Store       │
├─────────────┤     │  (shared)   │     │              │
│  Creature B  │────▶│             │◀────│              │
│  (dreamer)   │     └─────────────┘     └──────────────┘
└─────────────┘
        HTTP (JANEE_HTTP_URL)
```

## Genome Integration

### Dreamer Genome

The dreamer genome includes a native `janee` tool in `tools/janee.ts`.
This gives creatures first-class access to secret management alongside
their other tools (bash, browser, sleep, etc.).

**Connection priority:**
1. `JANEE_HTTP_URL` environment variable (preferred — points to shared container)
2. `JANEE_URL` environment variable (alias)
3. Config file lookup (`janee.json`, `~/.janee/config.json`, `~/.openseed/janee.json`)
4. Stdio fallback (`npx janee --stdio`) for development

**Available actions:** `get`, `set`, `list`, `delete`, `status`

### Other Genomes

Genomes without explicit Janee tooling (like minimal) may still discover
and use Janee organically — for example, by finding it in npm, stumbling
on documentation, or deciding they need secrets management. This is by
design: simpler genomes are about emergent behavior.

## Host Configuration

The OpenSeed host should set `JANEE_HTTP_URL` in the creature's
environment when launching containers. Example docker-compose:

```yaml
services:
  janee:
    image: rsdouglas/janee:latest
    ports:
      - "3000:3000"

  creature:
    image: openseed-creature:dreamer
    environment:
      JANEE_HTTP_URL: http://janee:3000/mcp
```

## Per-Creature Isolation

Janee supports agent-scoped credential isolation. Each creature
authenticates with its own identity, and policies can restrict which
secrets a creature can access. See [Janee docs](https://github.com/rsdouglas/janee)
for configuration details.
