# LLM Proxy Architecture

How creatures talk to LLMs, and why it works this way.

## The Problem

Creatures are autonomous processes that make LLM calls. But we need to:

1. **Keep API keys away from creatures.** A creature runs in a Docker container and can modify its own code. Giving it raw API keys means a rogue creature could leak or misuse them. The orchestrator holds the keys; creatures never see them.

2. **Support multiple LLM providers.** We want creatures running on Claude, GPT, or future models without changing creature code. The model is chosen at spawn time, not hardcoded into the creature's soul.

3. **Track costs per creature.** Every LLM call flows through a central point where we record token usage and compute cost. Without this, a creature could silently burn through budget.

## The Architecture

```
┌─────────────────────────────────────────────────────┐
│  Creature (Docker container)                        │
│                                                     │
│  mind.ts                                            │
│    ├── createAnthropic({ baseURL: proxy })           │
│    ├── generateText({ model: provider(MODEL), ... }) │
│    └── tools defined with AI SDK tool() + Zod       │
│                                                     │
│  Env vars:                                          │
│    ANTHROPIC_BASE_URL = http://host:7770             │
│    ANTHROPIC_API_KEY  = creature:<name>  (fake)      │
│    LLM_MODEL          = claude-opus-4-6 | gpt-5.2   │
└──────────────────┬──────────────────────────────────┘
                   │  Anthropic wire format
                   │  (AI SDK handles serialization)
                   ▼
┌─────────────────────────────────────────────────────┐
│  Orchestrator Proxy (src/host/proxy.ts)              │
│                                                     │
│  1. Identify creature from fake API key              │
│  2. Read model from request body                     │
│  3. Inject real API key                              │
│  4. Route:                                           │
│     ├── claude-* → forward to api.anthropic.com      │
│     └── gpt-*/o3/o4 → translate to OpenAI Responses  │
│  5. Record token usage in cost tracker               │
│  6. Return response to creature                      │
└─────────────────────────────────────────────────────┘
```

## Why Vercel AI SDK

We made a deliberate choice to have creatures use the [Vercel AI SDK](https://ai-sdk.dev) (`ai` package) rather than raw provider SDKs. This is the most consequential type decision in the project, so here's the reasoning:

**Creature code is hard to change.** Once a creature is spawned, it evolves its own codebase. It modifies `src/mind.ts`, learns new patterns, builds custom tools. Changing the LLM types in a running creature is invasive surgery: you're altering code the creature considers "self." The orchestrator, by contrast, is easy to change. It's our code, we control it, we can refactor it any time.

**This means the types creatures use must be the right long-term bet.** If we bake in Anthropic-specific types (`Anthropic.MessageParam`, `Anthropic.Tool`, `Anthropic.TextBlock`), we'd be coupling every creature to one provider's API shape forever. When we want to add Gemini or open-weight models, we'd need to perform surgery on every living creature.

**The AI SDK gives us provider-agnostic types at the creature level:**

- `ModelMessage` instead of `Anthropic.MessageParam`
- `tool()` + Zod schemas instead of `Anthropic.Tool` with raw JSON Schema
- `generateText()` instead of `client.messages.create()`
- `result.text` and `result.toolCalls` instead of parsing `response.content` blocks

The creature code doesn't know or care which LLM provider is behind the call. It speaks a universal language. The provider-specific translation happens in two places that are easy to change:

1. **`@ai-sdk/anthropic` provider** (in the creature) - serializes AI SDK types to Anthropic wire format
2. **The proxy** (in the orchestrator) - routes Anthropic wire format to the right upstream, translating to OpenAI format when needed

## How It Actually Works

### Creature side

The creature creates an Anthropic provider pointed at the proxy:

```typescript
import { generateText, type ModelMessage, tool } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

const provider = createAnthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL
    ? `${process.env.ANTHROPIC_BASE_URL}/v1`
    : undefined,
});

const MODEL = process.env.LLM_MODEL || "claude-opus-4-6";
```

Tools are defined with Zod schemas:

```typescript
const tools = {
  bash: tool({
    description: "Execute a bash command.",
    inputSchema: z.object({
      command: z.string(),
      timeout: z.number().optional(),
    }),
  }),
  set_sleep: tool({
    description: "Pause for N seconds.",
    inputSchema: z.object({
      seconds: z.number(),
    }),
  }),
};
```

LLM calls use `generateText`:

```typescript
const result = await generateText({
  model: provider(MODEL),
  maxOutputTokens: 16384,
  system: systemPrompt,
  tools,
  messages,
});

// result.text - the model's text response
// result.toolCalls - array of { toolName, toolCallId, input }
// result.response.messages - ModelMessage[] to append to history
```

Tool results go back as `role: "tool"` messages:

```typescript
messages.push(...result.response.messages);
messages.push({
  role: "tool",
  content: toolResults.map(tr => ({
    type: "tool-result",
    toolCallId: tr.toolCallId,
    toolName: tr.toolName,
    input: tr.input,
    output: { type: 'text', value: tr.output },
  })),
});
```

### Proxy side

The proxy intercepts requests at `/v1/messages` (Anthropic's endpoint). It:

1. Extracts the creature name from the fake `ANTHROPIC_API_KEY` header (`creature:okok`)
2. Reads the `model` field from the request body
3. If it's a Claude model → injects the real `ANTHROPIC_API_KEY` and forwards to `api.anthropic.com`
4. If it's a GPT/O-series model → translates the Anthropic request to OpenAI Responses API format, injects `OPENAI_API_KEY`, sends to `api.openai.com`, translates the response back to Anthropic format
5. Records input/output tokens in the cost tracker for the creature

The creature never sees real API keys. The proxy never modifies creature code. Each side does one job well.

## Why Not LiteLLM?

We evaluated LiteLLM as an alternative proxy. It's a Python project that provides a unified interface to many LLM providers. We rejected it because:

- **Language mismatch.** The entire project is TypeScript/Node.js. Adding a Python service creates operational complexity (separate process, health checks, failure modes).
- **Format assumptions.** LiteLLM expects OpenAI-format input. Our creatures speak Anthropic format (via the AI SDK provider). We'd need translation on both sides.
- **Our proxy is small.** The translation logic in `src/host/proxy.ts` is ~250 lines. It handles exactly the two providers we support. Adding a new provider means adding one translation function, not operating a separate service.

## Adding a New Provider

To add support for a new LLM provider (e.g., Gemini):

1. **In the proxy** (`src/host/proxy.ts`): Add a case to `inferProvider()`, write `translateToGemini()` and `translateFromGemini()` functions, add a `forwardToGemini()` handler. ~100 lines.
2. **In costs** (`src/host/costs.ts`): Add per-model pricing for the new models.
3. **In the dashboard**: Add the new model names to the spawn dropdown.

No creature code changes needed. Existing creatures continue working. New creatures can be spawned with the new model.

## Cost Tracking

Every LLM response includes token usage. The proxy extracts `input_tokens` and `output_tokens` from the response and calls `costs.record(creatureName, model, inputTokens, outputTokens)`. The cost tracker applies per-model pricing and maintains running totals per creature.

Current pricing is in `src/host/costs.ts`. The dashboard shows per-creature spend on the creature detail page.

## The baseURL Convention

One subtlety: the Anthropic SDK and the AI SDK's Anthropic provider have different `baseURL` conventions.

- The Anthropic SDK's `baseURL` is the root (e.g., `http://host:7770`). It appends `/v1/messages` itself.
- The AI SDK's `createAnthropic({ baseURL })` expects the URL to include `/v1` (e.g., `http://host:7770/v1`). It appends `/messages` from there.

The orchestrator sets `ANTHROPIC_BASE_URL=http://host:7770` (without `/v1`). Creature code appends `/v1`:

```typescript
const provider = createAnthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL
    ? `${process.env.ANTHROPIC_BASE_URL}/v1`
    : undefined,
});
```

This keeps the env var clean and the convention explicit.
