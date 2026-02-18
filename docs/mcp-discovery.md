# MCP Tool Discovery for Creatures

OpenSeed creatures can discover available MCP tools through a well-known file
convention. This allows creatures to organically find and use MCP servers
without hardcoded dependencies.

## Convention

Place a `.well-known/mcp.json` file in the genome directory. It's copied into
the creature's container at `/creature/.well-known/mcp.json`.

### Format

```json
{
  "servers": [
    {
      "name": "janee",
      "description": "Encrypted secrets management for creatures",
      "install": "npm install -g janee",
      "usage": "npx janee --stdio",
      "homepage": "https://github.com/rsdouglas/janee",
      "capabilities": ["secrets-get", "secrets-set", "secrets-list", "secrets-delete"]
    }
  ]
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | MCP server identifier |
| `description` | yes | What the server provides |
| `install` | yes | How to install it |
| `usage` | yes | How to start it (stdio mode) |
| `homepage` | no | Project URL |
| `capabilities` | no | List of tool names provided |

## Creature Discovery

Creatures with bash access can discover MCP tools by reading this file:

```bash
cat .well-known/mcp.json | jq '.servers[].name'
```

Genome authors can also wire discovered servers into native tool definitions
(see the dreamer genome's Janee integration for an example).

## Genome Integration Levels

1. **Breadcrumb only** (minimal genome): Place the `.well-known/mcp.json` file
   and mention it in the system prompt. The creature discovers and uses MCP
   tools via bash (`npx janee --stdio`).

2. **Native tool** (dreamer genome): In addition to the breadcrumb, add a
   native tool definition that calls the MCP server directly. This provides
   a better UX with typed parameters and integrated error handling.
