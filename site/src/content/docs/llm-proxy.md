---
title: LLM Proxy
description: How creatures talk to LLMs through a translating proxy, and why.
order: 6
section: core
---

## The Problem

Creatures run inside Docker containers and can modify their own source code. Giving them raw API keys is a non-starter: a creature could exfiltrate keys, change its own provider logic, or bypass cost controls. The proxy solves three problems at once:

1. **Key isolation** - real API keys never enter the container.
2. **Multi-provider support** - creatures speak one protocol regardless of the backing model.
3. **Cost tracking** - every response is metered per creature, per model.

## Architecture

Creatures use the Vercel AI SDK with the Anthropic provider, pointed at the orchestrator's proxy endpoint instead of `api.anthropic.com`.

```
Creature (Docker)
  → Vercel AI SDK (Anthropic provider)
    → POST to orchestrator proxy (fake API key in header)
      → Proxy identifies creature from key
      → Reads model from request body
      → Injects real API key
      → Routes to upstream provider
```

The "fake API key" is a creature identifier. The proxy maps it to the creature's name for cost tracking and logging.

## Provider Routing

The proxy inspects the requested model name to pick the upstream:

- **Claude models** (`claude-*`): forwarded directly to `api.anthropic.com`. The request is already in Anthropic format, so it's a passthrough with the real key injected.
- **GPT / O-series models** (`gpt-*`, `o3-*`, `o4-*`): the proxy translates from Anthropic message format to OpenAI Responses API format, forwards to `api.openai.com`, then translates the response back.

Translation is ~100 lines per direction. The creature never sees the difference.

## Why Vercel AI SDK

The choice of Vercel AI SDK at the creature level is deliberate. It provides provider-agnostic types (tool definitions, message arrays, streaming) so creature code doesn't encode assumptions about which LLM is behind the call.

This matters because creatures modify their own code. If a creature rewrites its cognition loop, the proxy still handles routing. The creature doesn't need to know (and shouldn't know) whether it's talking to Claude or GPT.

## Cost Tracking

Every LLM response includes token usage (input, output, cache reads/writes). The proxy extracts this from both Anthropic and OpenAI response formats and records it per creature, per model. The dashboard shows cumulative and per-session costs.

## Adding a New Provider

1. Add a case to `inferProvider()` matching the model name pattern.
2. Write `translateRequest()` and `translateResponse()` functions for the new provider's API format.
3. Add per-model pricing to the cost tracker.

No creature code changes required. Creatures keep calling the same proxy endpoint with the same Anthropic-format messages.
