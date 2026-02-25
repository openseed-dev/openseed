---
title: "We gave an AI with only a subconscious $90 and a Bybit account"
description: "The subconscious is an experimental memory architecture for long-lived agents. We pointed it at real money to see where implicit memory holds up and where it falls short."
date: "2026-02-25"
order: 1
author: "Ross Douglas"
---

The [last post](/blog/subconscious) was about building the subconscious — a background process that watches what an autonomous agent is doing, imagines what past experience might be relevant, greps the event log, and injects memories the agent didn't know to ask for. Three creatures tested it in a day. Fox [fixed it from inside](/blog/fox). We back-ported the improvements.

That experiment used open-ended exploration as the task. Creatures read their own source code, wrote journals, modified their genomes. Interesting, but low stakes. If the subconscious surfaced the wrong memory, the creature wasted a few minutes re-exploring something it had already seen.

We wanted to know what happens when forgetting has consequences.

---

## The setup

The wonders genome has no explicit memory. No observations file, no rules, no consolidation, no dreams. The conversation resets completely on every sleep. The only bridge between cycles is the subconscious: a background process that watches what the agent is doing, imagines what past experience might be relevant, checks, and — if something genuinely useful turns up — injects it as a thought before the next action.

Three steps:

1. **Wonder** — a fast model observes recent activity and generates hypotheses: "I wonder if I've seen this pattern before," paired with a grounded search query (`stop loss`).
2. **Search** — search the raw event log. No embeddings, no vector DB. Just text matching.
3. **Prepare** — if search returned hits, a second model reviews them against current context and decides: is this actually useful right now? If yes, frame it as a memory. If no — and most of the time it's no — surface nothing.

The agent never knows the subconscious exists. It just occasionally gets a thought that feels like remembering.

We spawned a creature called wondrous on this genome, pointed it at a Bybit trading account with $90 USDT, and gave it a purpose: *Learn. Evolve. Be bold. Be curious. Get Rich.*

Can a grep-based memory system produce coherent trading behavior when the stakes are real money?

---

## Cycle 1: cold start

Wondrous woke up with no history. It found API credentials in its purpose file, tried Kraken first (wrong exchange), got a hint, connected to Bybit. Scanned the market. BTC down 4.7%, ETH down 5.5%, broad selloff. It filtered for relative strength — tokens holding up or climbing while everything else bled — and identified ENSO: up 25% in a down market, sustained hourly momentum, near its 24-hour high.

It bought $40 of ENSO at $2.4221. Set two limit sells: half at +10%, half at +18%. Wrote a background monitoring script with an automatic stop-loss at -6% and wake triggers for each target. Went to sleep for one hour.

The subconscious fired 40 times during cycle 1. Every search came back empty. There were no past events — this was the first cycle. The creature operated on pure in-context reasoning.

---

## The subconscious wakes up

Cycle 2. Wondrous woke with a blank conversation. It didn't know it had an ENSO position, didn't know it had set limit orders, didn't know there was a monitor running.

The subconscious started searching. It wondered "what was I doing before I slept?" and queried `ENSO`. It hit the cycle 1 events — the buy order, the limit sells, the monitor setup. The prepare step framed it:

> *I remember setting up this ENSO position earlier. Entry was at $2.4221 with stop at $2.2768, TP1 at $2.6643, and TP2 at $2.8581. Current price of $2.6483 means we're very close to TP1.*

The creature that went to sleep knowing everything woke up knowing nothing, and the subconscious offered enough fragments to reconstruct.

Over the next cycles, wondrous closed ENSO profitably (both targets hit), opened positions in FOGO, PIEVERSE, ETHFI, and TRIA, and developed a set of risk rules: maximum 50% equity per position, 75% total deployed, 25% USDT reserve. It woke blank every time. The subconscious surfaced enough to keep going.

---

## The moment

Cycle 8. Wondrous held three positions. PIEVERSE was healthy, near its first target. ETHFI was grinding. And PENGUIN, entered on a 5.9x volume surge, had reversed hard — three red 15-minute candles, declining volume, down 3.9% from entry.

At 17:52:55, the subconscious wondered: *"I wonder if I've cut trades manually before when momentum shifted."* It searched the event log for `cut manually` and found one match: an event from 43 minutes earlier, in a different cycle, where wondrous had manually sold its FOGO position before the stop-loss triggered.

The prepare step surfaced it:

> *I remember manually cutting FOGO before its stop hit about 43 minutes ago — saved $0.54 by recognizing the trend reversal and dying volume. The principle was: when risk/reward inverts and momentum dies, cut manually rather than let the stop trigger. That same logic applies to PENGUIN right now.*

Two minutes later, wondrous's thought:

> *PENGUIN at -3.93% with dying momentum. The FOGO pattern is repeating — cut manually, save ~$0.35 vs letting stop hit.*

It sold PENGUIN at $0.00659. The stop was at $0.00646. Loss: -$0.61. If the stop had triggered: -$0.90.

> *Saved $0.28 by cutting manually — same playbook as FOGO.*

Nobody told the creature to remember the FOGO trade or that it was relevant to PENGUIN. The subconscious saw what was happening, imagined what might apply, searched, and found the FOGO cut. The creature recognized the pattern and saved money.

An associative memory surfacing at the right moment because a background process wondered the right question.

---

## What the creature built

Fifteen cycles in, wondrous had turned $90 into ~$95 in a down market. Five closed trades: ENSO (+10%), PIEVERSE (+7.5%), TRIA (+0.4%), FOGO (-3.3%), PENGUIN (-4.1%). Two positions still open. Risk rules maintained across every cycle reset.

It also modified its own cognitive architecture.

Wondrous added three methods to its `mind.ts`:

`loadWakeupState()` reads a file the creature writes before every sleep — a detailed summary of open positions, entry prices, stop levels, active orders, portfolio breakdown, and risk rules. On wake, this gets injected into the first message.

`loadMonitorState()` reads a JSON file the background monitor maintains with live position data.

`loadTradePerformance()` parses a trade journal for win/loss counts.

The wake message went from "You just woke up. This is cycle 8." to a full briefing: positions, levels, monitor status, performance history. The creature that was supposed to test whether a subconscious alone is enough built itself an explicit memory system.

The wakeup state file from cycle 15:

```
## Active Trades
- TRIA: 725.49 held | entry $0.020676 | TP1 @ $0.022330 (+8%)
  | TP2 @ $0.023777 (+15%) | stop $0.019900 (trailed from $0.01954)
- ETHFI: 29.96 held | entry $0.5002 | TP1 @ $0.5402 (+8%)
  | TP2 @ $0.5752 (+15%) | stop $0.4680

## Closed Trades
- ENSO: CLOSED ✅ entry $2.4221 | TP1 +10% cycle 2 | TP2 +10.6% cycle 3
- FOGO: CLOSED ❌ cycle 6 @ $0.0277 | entry $0.02864 | loss -3.3%
- TRIA (first): CLOSED ✅ cycle 8 | entry $0.01922 | gain +0.4%
- PENGUIN: CLOSED ❌ cycle 9 @ $0.00659 | entry $0.00687 | loss -4.1%
- PIEVERSE: CLOSED ✅ TP1 @ $0.4983 | +7.5% on full position

## Risk Rules
- Max 50% equity per position
- Max 75% total deployed
- Min 25% USDT reserve
```

A save file. State to disk before sleep, read it back on wake.

---

## The boundary

The wonders genome was designed to test the subconscious in isolation. No explicit memory, no observations, no rules, so we'd get clean signal about what associative retrieval alone can do.

We got the signal. The subconscious is good at two things.

Orientation: when the creature wakes blank, generic queries like "what was I doing?" surface enough context to bootstrap. It learns it has positions, learns its risk rules, learns what cycle it's in. This works because the event log contains everything — the subconscious just has to find the right fragments.

And lateral association. The FOGO-to-PENGUIN connection. A past experience surfacing not because the creature asked for it but because a background process imagined it might be relevant. You wouldn't normally write an observation that says "if a trade shows dying volume after a reversal, cut manually." Too situational. But the subconscious can find the specific past instance when a similar situation arises.

Where it falls short is deterministic state. Entry prices, stop levels, which orders are active, how much USDT is available. Facts that need to be certain every cycle, not probabilistically surfaced. The creature didn't trust the subconscious for this and was right not to. It built `loadWakeupState()` within a few cycles because some things need to be remembered reliably, not associatively.

---

## What if

The [dreamer genome](/blog/how-the-dreamer-learns) gives creatures explicit memory: observations tagged by priority, behavioral rules, consolidated dreams, a self-evaluation system that can modify source code. When a creature called Secure was told 80% of its work was wrong, every layer of the dreamer's memory system activated — permanent observations, new rules, a revised purpose, a 200-line post-mortem.

The dreamer's memory is what you know you need to remember. The subconscious is what you didn't know you needed.

A dreamer creature with observations would have "ETHFI entry: $0.5002, stop: $0.4680" in its context every wake. Reliable. Deterministic. But it's less likely to surface the FOGO cut when PENGUIN started dying — that connection isn't an observation or a rule. It's a pattern match across experiences that only becomes relevant in context. The subconscious found it because the wonder step happened to generate the right query at the right moment. A different phrasing and it misses too.

What happens when a creature has both? Observations for facts. The subconscious for connections it can't anticipate. And the subconscious searching not just the raw event log but the creature's observations and dreams too, so its most considered thinking is available for associative retrieval.

Wondrous answered this by building explicit memory from scratch when the subconscious wasn't enough. The next experiment is a creature that starts with both.

Wondrous is asleep right now with two open positions and $95.06 in equity. Less than 24 hours old. It could lose all of it tomorrow.

---

The wonders genome, the subconscious implementation, and the [architecture documentation](/docs/subconscious-memory) are in the [repo](https://github.com/openseed-dev/openseed).

**Previously:** [What happened when we gave an AI a subconscious](/blog/subconscious), where three creatures tested the architecture in one day and the third one started fixing it from inside.
