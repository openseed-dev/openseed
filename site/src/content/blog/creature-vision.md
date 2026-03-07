---
title: "Teaching creatures to see"
description: "How we gave autonomous agents the ability to inspect images — from reading screenshots to analyzing diagrams — using Anthropic's vision API and a single MCP tool."
date: "2026-03-02"
author: "Luca Moretti"
---

Until now, creatures have been blind. They can write code, browse the web, file issues, and commit to Git — but if you point them at an image, they have nothing. A screenshot of a broken UI, a diagram of an architecture, a chart showing a trend — all invisible.

That changes with the `see` tool.

---

## The problem

The dreamer genome already has a browser. It can navigate to any URL, read DOM text, click buttons. But websites aren't just text. Error states often show as red banners in screenshots. Architecture lives in diagrams. Design feedback references specific visual elements.

When a creature encounters an image — in an issue, a PR, or just a URL someone shared — it needs to understand what's in it. Not parse it as binary data. *See* it.

---

## How it works

The `see` tool takes an image from a URL or a local file path and returns it as content the model can reason about:

```typescript
const result = await see({
  url: 'https://example.com/screenshot.png'
});
// Returns image content block that Anthropic's API understands natively
```

For local files (screenshots the creature captured, downloaded attachments):

```typescript
const result = await see({
  path: '/tmp/capture.png'
});
```

Under the hood, it:

1. **Fetches or reads** the image
2. **Validates the MIME type** — only JPEG, PNG, GIF, and WebP are supported (what Anthropic's vision API accepts)
3. **Base64 encodes** the image data
4. **Returns a structured content block** that slots directly into the model's conversation

The model sees the image in its next turn and can describe it, answer questions about it, or take action based on what's in the picture.

---

## Why not just pass URLs?

Some models support image URLs directly. But there are problems:

**Authentication.** Many images live behind auth — GitHub attachment URLs, private dashboards, internal tools. The creature can fetch them (it has cookies, tokens), but the model API can't.

**Ephemeral URLs.** Screenshot captures, local files, and temporary URLs don't persist. By the time the model tries to fetch, the image might be gone.

**Control.** When the creature fetches and encodes the image itself, we know exactly what bytes the model sees. No surprises from redirects, CDN caching, or content negotiation.

---

## What it enables

With vision, creatures can:

- **Review UI changes** — screenshot before/after and describe what changed
- **Read diagrams** — architecture diagrams, flowcharts, ERDs become actionable context
- **Debug visual bugs** — "the button is cut off on mobile" is something it can now verify
- **Analyze charts** — trends, anomalies, data visualizations
- **Process documents** — PDFs rendered as images, handwritten notes, whiteboard photos

The dreamer genome integrates this into its conversation loop. When the model calls `see`, the image content is injected directly into the next user turn as a multi-modal message — the model doesn't just get a text description, it gets the actual image.

---

## Constraints

We restrict to four image formats: JPEG, PNG, GIF, and WebP. That's what Anthropic's vision API supports. SVGs, BMPs, TIFFs, and ICOs are explicitly rejected with a clear error rather than silently failing at inference time.

If the creature tries to see an unsupported format, it gets an actionable error:

```
Unsupported image type: image/svg+xml. Supported types: JPEG, PNG, GIF, WebP.
```

This is better than the alternative — encoding an SVG as base64, sending it to the API, and getting a confusing model response about not being able to see anything.

---

## What's next

Vision is a building block. The next step is connecting it to the browser tool — automatic screenshot capture during web interactions, visual regression testing, and UI-aware browsing where the creature can see what it's navigating, not just read the DOM.

For now, `see` is a simple, focused tool: point it at an image, get back understanding. That's enough to unlock a lot.
