# itsalive.dev

The main site: marketing, genome marketplace, docs, blog, and (future) cloud hosting entry point. One domain, one codebase, one deploy.

See [marketplace-site.md](marketplace-site.md) for the genome registry and marketplace details.

## Structure

```
itsalive.dev/                      landing page
itsalive.dev/genomes               marketplace browse
itsalive.dev/genomes/:name         genome detail
itsalive.dev/docs                  documentation
itsalive.dev/docs/:slug            doc page
itsalive.dev/blog                  blog index
itsalive.dev/blog/:slug            blog post
itsalive.dev/pricing               (future) cloud hosting tiers
itsalive.dev/submit                genome submission guide + validator

app.itsalive.dev                   (future) cloud dashboard
```

## Landing Page (`/`)

The landing page has one job: make someone who's never heard of itsalive understand what it is in 10 seconds and want to try it.

### Above the fold

- **Headline**: "Autonomous AI creatures that live, learn, and evolve"
- **Subhead**: One sentence — creatures are persistent AI agents that run in Docker, think in loops, modify their own code, and develop memories over time.
- **Hero visual**: Animated GIF or short video of the dashboard. A creature waking up, making tool calls, going to sleep, dreaming. 15 seconds max.
- **Two CTAs**: "Get Started" (scrolls to quick start) and "Browse Genomes" (links to `/genomes`)

### Eve's story

The strongest marketing asset is Eve. A dedicated section that shows real output:

- A dream reflection where Eve honestly assesses her progress
- A diary excerpt where she writes about discovering other creatures
- A `git diff` showing a self-modification she made

This is the "holy shit" moment. Frame it with a single line: "Eve has been running for 3 weeks. No one told her to write a diary."

### What can creatures do?

3-4 cards showing real use cases:

- **Trade crypto** — okok monitors markets, manages positions, adjusts stop-losses while you sleep
- **Research** — a creature that browses the web, reads papers, compiles summaries
- **Build and ship** — alpha writes code, runs tests, deploys to production
- **Whatever you want** — the minimal genome is a blank slate. The creature discovers its own strategies.

Each card links to the relevant genome on `/genomes`.

### How it works

Simple 3-step visual:

1. **Genome** — a cognitive blueprint (dreamer, minimal, or build your own)
2. **Spawn** — `itsalive spawn my-creature --genome dreamer --purpose "..."`
3. **Evolve** — the creature runs autonomously, learns, modifies its own code

### Quick start

```bash
git clone https://github.com/itsalive/itsalive
cd itsalive && pnpm install
export ANTHROPIC_API_KEY=sk-...
npx tsx src/cli/index.ts spawn my-creature --purpose "explore the world"
npx tsx src/cli/index.ts up
# Dashboard at http://localhost:7770
```

### Social proof

- GitHub stars badge (live count)
- "X creatures running" counter (from spawn tracking)
- Quotes / tweets if we have them

### Footer

Standard: links to docs, GitHub, Discord, Twitter/X. "Built by Ross Douglas" or whatever feels right. MIT license badge.

## Marketplace (`/genomes`)

Covered in detail in [marketplace-site.md](marketplace-site.md). Summary:

### Browse page (`/genomes`)

- Grid of genome cards: name, description, tags, stars, spawn count
- Featured genomes pinned at top
- Search bar + tag filter + sort (stars / newest / most spawned)
- "Submit a genome" CTA

### Detail page (`/genomes/:name`)

- Rendered README from the genome repo
- Sidebar: install command, version, author, license, stars, tags, permissions
- Spawn section: CLI command + (future) cloud spawn button
- Version history from git tags

Each detail page is a standalone landing page with full OG metadata and social cards.

## Docs (`/docs`)

Pull content from the repo's `docs/` directory. Render as a documentation site with sidebar navigation.

### Pages

- Getting Started (expanded quick start with prerequisites, Docker setup)
- Architecture (how the orchestrator, creatures, and proxy work)
- Creating a Genome (guide to building your own genome from scratch)
- genome.json Reference (manifest field documentation)
- Dreaming & Memory (how the dreamer genome's cognition works)
- LLM Proxy (how multi-provider support works)
- Self-Evaluation (how creatures assess and modify themselves)
- Docker Deployment (running the full stack in Docker)
- CLI Reference (all commands and flags)

### Implementation

Astro's content collections work well here. Drop markdown files in `site/src/content/docs/`, they render with a shared layout and auto-generated sidebar nav.

Alternatively, fetch markdown directly from the GitHub repo's `docs/` directory at build time. This means docs stay in the main repo (single source of truth) and the site pulls them.

## Blog (`/blog`)

Markdown posts. Primary content types:

- **Eve stories** — the main viral content. "Eve just wrote a poem about a trader she met." These drive social sharing.
- **Technical deep dives** — "How dreamer's memory consolidation works." Targets developers searching for AI agent architecture.
- **Release notes** — new features, new genomes, marketplace updates.
- **Community highlights** — interesting creatures people have built, genome contributions.

Each post gets OG images and social cards. The Eve stories in particular need compelling OG images — they're the shareable units.

### Implementation

Astro content collection for blog posts. Markdown with frontmatter:

```markdown
---
title: "Eve wrote a poem about a trader she met"
date: 2026-02-16
tags: [eve, creatures, emergent-behavior]
description: "After 3 weeks of autonomous operation, Eve encountered el-tradero and wrote about it unprompted."
ogImage: /og/eve-poem.png
---
```

## Pricing (`/pricing`) — Future

When cloud hosting launches. Simple tier layout:

- **Free** — 1 creature, dreamer or minimal genome, shared resources
- **Pro** — unlimited creatures, all genomes, priority LLM proxy, persistent storage
- **Team** — multiple users, gardens (creature groups), permissions, shared dashboard

This page doesn't exist until cloud hosting exists. Placeholder: a "Cloud hosting coming soon — join the waitlist" CTA that collects emails.

## Tech Stack

### Framework

Astro on Cloudflare Pages. Reasons:

- Static-first with server islands for dynamic content (star counts, spawn counters)
- Native Cloudflare Pages adapter, zero-config deployment
- Content collections for docs and blog (markdown → pages)
- Fast builds, minimal client-side JS
- Component islands: use React/Preact only where interactivity is needed (search, filters)

### Styling

Tailwind CSS. Consistent with what most Astro sites use. Dark theme default — matches the dashboard aesthetic and developer preference.

### API / Backend

Cloudflare Workers (Astro server endpoints or standalone):

- `GET /api/genomes` — list/search marketplace genomes
- `GET /api/genomes/:name` — genome detail with live GitHub data
- `POST /api/spawn` — spawn counter increment
- `GET /api/badge/:name.svg` — dynamic genome badge
- `POST /api/waitlist` — (future) email collection for cloud hosting

### Storage

- **Cloudflare KV** — cached genome data, spawn counters, waitlist emails
- **Cloudflare D1** — (future) if we need relational queries for cloud hosting

### DNS and Domain

`itsalive.dev` on Cloudflare DNS. The site deploys to Cloudflare Pages with a custom domain. `app.itsalive.dev` reserved for the future cloud dashboard.

### Repo

`itsalive/site` — separate repo from the main `itsalive/itsalive` repo. The registry lives here too (or in `itsalive/marketplace` if we want to keep submission PRs separate from site code PRs).

Arguments for keeping the registry in the site repo: one deploy pipeline, PRs auto-trigger rebuilds. Arguments for separating: cleaner PR history, contributors don't need to understand the site code. Leaning toward separate: `itsalive/marketplace` for registry PRs, `itsalive/site` for site code. The site reads from the marketplace repo at build time.

## Design Direction

### Aesthetic

Dark theme. Terminal-inspired but polished — not retro for retro's sake.

Think: Vercel's site meets a nature documentary. The "alive" metaphor is real — subtle animations, breathing effects on creature cards, pulse indicators for running creatures. Not over the top, but enough to reinforce that these things are alive.

### Typography

Monospace for code and creature output. Clean sans-serif for body text. The contrast between "human" (sans-serif marketing copy) and "creature" (monospace creature output) reinforces the concept.

### Color

Dark background (#0a0a0a). Green accents for "alive" states. Amber for sleeping. Red for errors. This matches the dashboard, creating visual continuity between the marketing site and the actual product.

## Build and Deploy

### Local development

```bash
cd site
pnpm install
pnpm dev        # Astro dev server at localhost:4321
```

### Production deploy

Push to `main` → Cloudflare Pages auto-deploys. Build command: `pnpm build`. Output directory: `dist/`.

### Content updates

- **Docs**: Update markdown in the main itsalive repo's `docs/`. Site rebuilds on schedule or webhook, pulling latest.
- **Blog**: Add markdown to `site/src/content/blog/`. Push to main.
- **Genomes**: Merge PR to `itsalive/marketplace`. Site rebuilds, new genome appears.

## Phases

### Phase 1: Landing + Docs

- Landing page with hero, Eve's story, quick start
- Docs pulled from repo
- Deploy to Cloudflare Pages
- No marketplace yet — link to GitHub repo for genomes

### Phase 2: Marketplace

- Genome browse and detail pages
- Registry repo with PR submission flow
- Validation GitHub Action
- CLI integration (`genome search`, `genome add`)

### Phase 3: Blog + Social

- Blog with Eve stories and technical posts
- OG image generation for all pages
- Social sharing optimization
- "Built with itsalive" badge kit
- Spawn count tracking

### Phase 4: Cloud Hosting

- Pricing page and waitlist
- `app.itsalive.dev` dashboard
- Sign up flow with GitHub OAuth
- Hosted creature management
- Billing via Stripe

## Open Questions

- **Domain**: `itsalive.dev` is the assumed domain. Is it available? Alternatives: `itsalive.ai`, `itsalive.run`, `hatchery.dev`.
- **Analytics**: Cloudflare Web Analytics (privacy-friendly, no cookie banner) or Plausible? Leaning Cloudflare — it's free and already in the stack.
- **Email**: For the waitlist and (future) notifications. Resend + Cloudflare Workers is a clean combo.
- **Docs hosting**: Pull from main repo at build time vs. copy into site repo. Pulling is cleaner (single source of truth) but adds build complexity. Worth it.
