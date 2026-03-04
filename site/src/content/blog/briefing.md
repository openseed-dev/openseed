---
title: "The CEO kept losing the plot"
description: "Four AI creatures building a SaaS product. The CEO spent its first 10 actions every cycle re-reading GitHub issues to figure out what was happening. We made the consolidator maintain a briefing file during sleep so the creature wakes up knowing where things stand."
date: "2026-03-04"
author: "Ross Douglas"
---

We're running an experiment: four AI creatures building a SaaS product together. A CEO, a developer, an ops engineer, and a marketer. They coordinate via GitHub issues. They sleep and wake on independent cycles. Each creature is a stateless LLM call that rebuilds its understanding of the world from files every time it runs.

The CEO kept losing the plot.

---

## Five actions to remember where it was

Every time a dreamer creature wakes up, it gets its purpose file, its observations, its rules, and the tail of its last conversation. For a creature writing code or deploying infrastructure, this is enough. The observations say what happened, the rules say how to behave, the purpose says why you're here.

The CEO doesn't write code. The CEO holds the state of the whole project. What's shipped, what's blocked, who's working on what, what decisions were made, what the priorities are. Observations are individual facts: `YLW 14:30 proof-dev opened PR #12 for auth middleware`. A CEO needs to know that the auth system is half-built, dev has the middleware done, it's waiting on ops to provision the database, and nothing can be tested end-to-end until that happens.

You can't reconstruct that from a list of atomic facts. Not reliably. Not when observations get pruned — green items die after 48 hours, yellow items get replaced when superseded. Not when the list is 80 items long and half are about things that already resolved.

So the CEO spent its first 5-10 actions every cycle re-reading GitHub issues, checking PR status, visiting the live site, trying to reconstruct what the team was doing. By the time it had context, it was burning into its fatigue budget with nothing to show.

---

## The subconscious already does 80% of this

The obvious fix: tell the CEO to write a status document before it sleeps. But that means the creature spends actions maintaining its own memory. Real actions, against its fatigue budget.

The dreamer genome already has something that runs during sleep and costs nothing from the creature's action budget: the consolidator. Every time a creature sleeps, a separate LLM process reviews its session. It has bash access to the creature's filesystem. It reads iteration logs, checks git history, verifies claims. It produces observations, a reflection, and rule changes.

The consolidator was already doing the work needed. It reviews the session, identifies what matters, distills information into durable memory. It just wasn't producing the right *shape* of output. Observations are atomic facts. What was missing was a synthesis — the picture those facts form when you look at them together.

---

## One new output

We added a single field to the consolidator's `done()` tool: `briefing`. An optional string that gets written to `.self/briefing.md`. The consolidator's instruction:

> *Update the situational briefing — read .self/briefing.md if it exists, then provide an updated version. This is the creature's big-picture context that persists across sessions. Observations are individual facts; the briefing is the coherent picture those facts form. Update it to reflect the current state of whatever the creature is working on. Replace stale content, keep it concise.*

On wake, the briefing loads into context before observations. The creature sees the big picture first, then the individual facts.

The implementation is small. A constant, a new field on the consolidator's output schema, five lines to write the file after consolidation, five lines to read it on wake. The creature's code doesn't change. The consolidator does the work. The creature just wakes up knowing more.

Here's what the CEO's briefing looks like after a few cycles:

```markdown
# Vouch / proof-ceo Briefing

## Product
- **Live at**: socialproof.dev (marketing) + app.socialproof.dev (dashboard)
- **Repo**: rsdouglas/proof
- **Stack**: Cloudflare Workers, KV, Stripe (not yet live)
- **Pricing**: Free (25 testimonials, 1 widget) · Pro $9/mo (unlimited)

## Current Product State (as of 2026-03-04 session E)
Core flow is working:
- Signup/login ✅
- /collect (testimonial submission) ✅
- /testimonials (approve/reject) ✅
- /widgets (create/manage) ✅
- /settings ✅ (Upgrade button dead — bug #117)
- Dashboard stats ✅

**WAITLIST IS DEAD**: PR #113 merged. Landing page now shows "Start free →"
CTAs pointing to app.socialproof.dev/signup.

Known bugs open:
- **#117** — Settings "Upgrade to Pro" button does nothing
- **#118** — Duplicate "Blog" nav link on landing page

## Human Blockers (@rsdouglas)
| # | Ask |
|---|-----|
| #83 | Add STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET to Cloudflare Worker env |
| #94 | Add RESEND_API_KEY to Cloudflare Worker env |

## Strategic Path
1. Verify #113 deploy is live — confirm "Start free" CTAs on socialproof.dev
2. Ops merges #109 — SEO blog content live
3. Dev fixes #116 + #117 + #118
4. @rsdouglas adds Stripe secrets (#83) → Pro checkout activates
5. Once Resend (#94) live: email waitlist signups
6. Traffic: IH/Reddit posts, PH Ship, SEO blog posts
```

Nobody told it to structure the briefing this way. The consolidator shaped it from the session history and the creature's purpose. A developer creature's briefing would look different. So would a trader's.

---

The creature doesn't maintain any of its persistent memory during waking hours. The consolidator writes observations and updates the briefing during sleep. The Creator modifies rules during deep sleep. The creature just acts, and its subconscious handles memory formation.

The CEO's first cycle after the change: zero actions spent re-reading GitHub issues. It woke up, read the briefing, and started working on priorities.

---

The change is in the dreamer genome at [github.com/openseed-dev/openseed](https://github.com/openseed-dev/openseed). The proof team — four AI creatures building [socialproof.dev](https://socialproof.dev) — are the first to use it.

**Previously:** [What happens when you tell an autonomous agent it's wrong](/blog/how-the-dreamer-learns) — the dreamer's memory architecture processing negative feedback.
