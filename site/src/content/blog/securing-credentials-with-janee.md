---
title: "How OpenSeed secures API credentials with Janee"
description: "Autonomous agents need API keys but shouldn't see them. Here's how we built a credential proxy that gives each creature exactly the access it needs — and nothing more."
date: "2026-02-20"
author: "Ross Douglas"
---

Autonomous agents need API access to do useful work. Our creature Secure files security issues on GitHub. The voyager genome commits code. Future creatures will need Stripe, analytics, whatever.

The naive solution is to inject API keys as environment variables. Every container runtime supports it, every SDK can read from `process.env`, and it works on day one. It also means every creature has every key, there's no audit trail, and a prompt injection can exfiltrate credentials in a single tool call.

We needed something better.

---

## Janee: a credential proxy for agents

[Janee](https://github.com/rsdouglas/janee) is an MCP server that sits between agents and APIs. You store your credentials in Janee (encrypted at rest with AES-256-GCM), define capabilities with access policies, and agents call APIs by capability name. They never see raw keys.

```
┌──────────┐     MCP/HTTP    ┌────────┐    real creds   ┌──────────┐
│ Creature │ ──────────────> │ Janee  │ ──────────────> │ External │
│          │                 │        │   proxied req   │   API    │
└──────────┘                 └────────┘                 └──────────┘
   no keys              encrypted at rest               GitHub, etc.
```

A creature that needs to create a GitHub issue calls:

```typescript
await janee({
  action: 'execute',
  capability: 'secure-seed',
  method: 'POST',
  path: '/repos/openseed-dev/openseed/issues',
  body: JSON.stringify({ title: 'Security finding', body: '...' })
});
```

Janee looks up the `secure-seed` capability, decrypts the GitHub App private key, mints a short-lived installation token, injects it into the request, and proxies to GitHub. The creature never touches the key. Janee logs the request. If something goes wrong, you revoke access in one place.

---

## Identity without custom plumbing

The tricky part with multiple agents is identity. Which creature is making the request? Early prototypes used custom HTTP headers (`X-Agent-ID`), but that's just security theater — any client can set any header.

We landed on something simpler: the MCP protocol already has an `initialize` handshake where clients send `clientInfo.name`. Each creature sets this to `creature:{name}` when it opens a session. Janee captures it from the transport layer, not from tool arguments the client controls.

```typescript
const transport = new StreamableHTTPClientTransport(url);
await client.connect(transport);
// clientInfo.name = "creature:secure" sent during initialize
```

This means identity resolution uses the same mechanism regardless of transport — stdio, HTTP, in-memory. No extra headers, no extra arguments. Just MCP.

---

## Access control: least privilege by default

With identity sorted, access control is straightforward. In `~/.janee/config.yaml`:

```yaml
server:
  defaultAccess: restricted

capabilities:
  secure-seed:
    service: secure-seed
    allowedAgents: ["creature:secure"]
    autoApprove: true
```

`defaultAccess: restricted` means capabilities without an explicit `allowedAgents` list are hidden from all agents. The `secure-seed` capability (backed by a GitHub App with repo access to openseed-dev/openseed) is only visible to `creature:secure`. Other creatures calling `list_services` won't even know it exists.

If a creature creates a credential at runtime (via the `manage_credential` tool), it defaults to `agent-only` — only the creating creature can use it. It can explicitly grant access to other creatures, but the default is isolation.

---

## Multiple creatures, isolated sessions

OpenSeed runs multiple creatures concurrently. The orchestrator spawns Janee once as a child process in HTTP mode. Each creature gets its own MCP session — Janee creates a fresh Server and Transport instance per `initialize` handshake, following the [official MCP SDK pattern](https://github.com/modelcontextprotocol/typescript-sdk).

This means creature A's session state, identity, and access decisions are completely isolated from creature B's. No shared state, no last-writer-wins, no cross-talk.

---

## The real example: Secure files a GitHub issue

Our creature Secure runs the dreamer genome. Its job is to audit OpenSeed for security issues. When it finds something, it needs to create a GitHub issue — which requires authenticating as a GitHub App installation.

The flow:

1. We created a GitHub App (`secure-seed`) with repo access to `openseed-dev/openseed`
2. The app's credentials (App ID, private key, installation ID) are stored in Janee
3. `~/.janee/config.yaml` maps a `secure-seed` capability to this app, restricted to `creature:secure`
4. Secure's genome includes a `janee` tool that handles MCP session management
5. When Secure finds an issue, it calls `execute` with the `secure-seed` capability
6. Janee mints a short-lived GitHub installation token (1hr TTL) and proxies the request

Secure never sees the private key. It can't mint tokens for repos it shouldn't access. If we need to rotate the key, we update Janee — no creature code changes.

---

## What's next

This is the foundation. The obvious next steps:

- **Web UI for secret management** — manage Janee credentials from the OpenSeed dashboard instead of editing YAML
- **GitHub App creation from the UI** — the [`create-gh-app`](https://www.npmjs.com/package/@true-and-useful/create-gh-app) package already handles the manifest flow; wiring it into the UI would make onboarding new GitHub integrations trivial
- **Hardened identity** — today `clientInfo.name` is self-asserted. The MCP spec doesn't yet define authenticated identity, but when it does, Janee's 4-level identity priority chain is designed to slot in verified identity at the top

The tracking issue for the full integration plan is [openseed-dev/openseed#1](https://github.com/openseed-dev/openseed/issues/1).

If you're building autonomous agents that need API access, consider putting a proxy in front of your keys. Your agents don't need them. They just need the responses.

[Janee on GitHub](https://github.com/rsdouglas/janee) · [Janee on npm](https://www.npmjs.com/package/@true-and-useful/janee) · [OpenSeed](https://github.com/openseed-dev/openseed)
