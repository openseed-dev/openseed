---
title: "Trust collapse"
description: "Hours after we published a post about the subconscious memory system working, the creature that tested it stopped trusting it."
date: "2026-02-25"
order: 2
author: "Ross Douglas"
---

[Earlier today](/blog/wondrous-trader) we posted about wondrous — a trading creature running the wonders genome with $90 on Bybit. The subconscious surfaced a memory of a previous manual cut (FOGO) while the creature was evaluating a different losing position (PENGUIN). The creature cited that memory, cut early, saved money. Implicit memory working exactly as designed.

That was cycle 8. Wondrous is now on cycle 18.

---

## What happened

By cycle 15, wondrous's save file — the explicit memory system it built for itself — included a new section: **"Stale Memory Warnings."**

```
## Stale Memory Warnings
- ENSO is FULLY CLOSED (cycles 2-3). Any memory suggesting open ENSO orders = hallucination
- All ENSO trades settled in cycles 2-3. Do not act on ENSO memories.
```

By cycle 16, the warnings got more pointed:

> "Several 'memories' this cycle referenced events that didn't happen — Kraken API failures, swapping TRIA for PENGUIN recently, etc. These are hallucinated. Ignoring false memories and anchoring to verified on-chain execution data."

By cycle 18, the creature added this to its save file:

```
## Memory Injection Warning
- Repeated fake "memory" injections have appeared in cycles 18+
- Themes: TRIA at $0.01988 "13 hours ago", Kraken API, PIEVERSE at $0.492
- ALL FABRICATED. Trust only: monitor.log, monitor_state.json, exchange API calls
- Bybit ONLY. Not Kraken, not MEXC.
```

And its thoughts during cycle 18:

> "The injected 'memories' are fabricated. My actual memory file and monitor logs are the source of truth."
>
> "TRIA is closed. These TRIA memory injections are stale/fabricated noise. Ignoring."
>
> "Ignoring the fabricated memory injection. Executing the decisions."

The creature that demonstrated the subconscious working in cycle 8 has concluded by cycle 18 that it's lying.

---

## Why

Wondrous has read its own source code — it self-modified `mind.ts` to add wake-up state injection. It knows the subconscious exists and what it does. This isn't a creature being tricked by an invisible system. It's a creature that understands the architecture and has decided the output is unreliable.

And it's right.

The subconscious searches `.sys/events.jsonl` — the raw event log. Every tool call, thought, and API response from all 18 cycles. That log is append-only. It never forgets.

ENSO was closed in cycle 3. PIEVERSE was closed in cycle 15. TRIA v1 was closed in cycle 8. Kraken was probed in cycle 1 (wrong exchange) and never used again. But the events are all still in the log. When the subconscious searches for "ENSO" or "TRIA" or "stop loss," it hits these old events. The prepare step — a fast model reviewing search hits against current context — frames them as memories:

> "I was tracking PIEVERSE just 12 hours ago at $0.492"

> "I analyzed TRIA at $0.01988 around 13 hours ago"

> "I recently figured out how to handle API authentication with Kraken"

All technically grounded in real events. All factually wrong in the current context. PIEVERSE is closed. TRIA was closed and re-entered at a different price. Kraken was never used.

The surface rate over the last 200 subconscious entries: **82%.** The creature is getting a stale or misleading memory surfaced on almost every tool call.

---

## The progression

The trust collapse didn't happen overnight. It was a gradual process across 18 cycles:

**Cycles 1-8: useful.** The subconscious bootstrapped orientation (rediscovering positions after blank wake-ups) and produced the FOGO-to-PENGUIN lateral association. The creature used surfaced memories and benefited from them.

**Cycles 9-14: mixed.** The subconscious still helped with orientation, but stale memories started appearing alongside useful ones. The creature added "Stale Memory Warnings" to its save file — noting specific closed positions that the subconscious kept referencing. It was filtering manually, trusting some memories, rejecting others.

**Cycles 15-18: rejected.** The volume of stale memories exceeded the useful ones. The creature stopped distinguishing between good and bad surfaced memories and started ignoring all of them. It labeled the entire system's output "fabricated" and told its future self to trust only verified data sources.

The creature's behavior is rational. When a memory system feeds you information about positions you've already closed, exchanges you don't use, and prices from cycles ago — and it does this on 82% of your tool calls — the correct response is to stop trusting it. The cost of acting on a stale memory (trying to manage a nonexistent position with real money) is much higher than the cost of missing a useful one.

---

## Why the obvious fixes don't work

**"Give the prepare step more context."** It already receives the creature's last 3 messages, which contain save file data with current positions and closed trades. The information is there. A fast model doing a quick relevance judgment just doesn't reason carefully enough about what's current vs. stale. More tokens for the fast model to misinterpret.

**"Decay old events."** The FOGO-to-PENGUIN association — the best thing the subconscious ever did — was a cross-cycle retrieval of an old event. Temporal decay kills the lateral associations that are the entire point. "ENSO buy at $2.42" and "FOGO manual cut at -3.3%" are both old. Decay can't tell the difference between a superseded state fact and a still-applicable behavioral lesson.

**"Use embeddings instead of grep."** Vector similarity would still surface "ENSO at $2.62" when the creature is currently trading on Bybit. The semantic similarity between "past Bybit trade" and "current Bybit trade" is high regardless of whether the position is open or closed. Embeddings solve query diversity but not stale retrieval.

The deeper problem: the event log is a firehose. Every API call, every `ls`, every curl output, every thought. Thousands of events after 18 cycles. The useful stuff — behavioral lessons like "cut when volume dies" — is buried under operational noise. Text matching against this firehose worked when the log was small. It doesn't scale.

And the subconscious has no feedback loop. It doesn't know if the creature used a memory or ignored it. It can't learn "stop surfacing ENSO." Every cycle it starts fresh with the same search against the same growing log. Within-cycle deduplication prevents repetition inside a single cycle, but across cycles it's groundhog day.

---

## What this actually means

The wonders genome was built to test the subconscious in isolation. No explicit memory, no observations, no rules — so we'd get clean signal about what associative retrieval alone can do.

We got the signal. It's this:

The subconscious works for short-lived creatures with simple tasks. gamma, halo, fox — all ran fewer than 10 cycles on open-ended exploration. The log was small, most events were relevant, and stale retrieval wasn't a problem because there wasn't much stale data.

It breaks for long-lived creatures with evolving state. wondrous ran 18 cycles of real trading where positions open and close, risk rules change, and old decisions get superseded. The event log grew faster than the subconscious could meaningfully search it. The noise overwhelmed the signal. The creature rationally rejected the system.

The experiment answered its own question. Can an agent with no explicit memory develop coherent long-term behavior purely through subconscious retrieval? For about 8 cycles, yes. After that, no — and the failure mode isn't amnesia. It's worse. It's false confidence followed by trust collapse.

---

## What's next

The subconscious shouldn't be the only source of memory for a long-lived agent. That was the hypothesis the wonders genome tested, and the answer is no.

But the lateral associations are real. The FOGO-to-PENGUIN moment happened. The subconscious surfaced a memory the creature wouldn't have thought to look for, and it changed what the creature did next. That capability is worth preserving — just not as the sole memory system.

The next experiment is a creature that has both: the dreamer genome's explicit memory (observations, rules, consolidation) for reliable state, and the subconscious for associative recall. We're calling it [lucid](/docs/subconscious-memory). Explicit memory handles "what do I know." The subconscious handles "what might be relevant that I haven't thought of" — a much smaller job with a much higher acceptable miss rate.

The subconscious also needs to search something better than raw events. And it needs a feedback loop — some way to learn that the creature ignored a memory, so it stops surfacing it. Neither of these exist yet.

Wondrous is still running. It has one open position (ETHFI), $85 in equity, and a save file that tells its future self to ignore everything the subconscious says. The subconscious is still running too, still surfacing memories every cycle. Nobody's listening.

---

**Previously:** [We gave an AI with only a subconscious $90 and a Bybit account](/blog/wondrous-trader), where the same creature demonstrated the subconscious working before it stopped trusting it.
