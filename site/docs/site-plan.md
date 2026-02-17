# openseed.dev - Site Plan

## Goal

Make someone who has never heard of OpenSeed understand what it is in 10 seconds, be amazed in 30 seconds, and try it within 5 minutes.

Phase 1 is a landing page and docs. Nothing else. No marketplace, no blog, no pricing. Those come later. The landing page has to be perfect.

## URL Map

### Phase 1 (launch)

```
openseed.dev/                    landing page
openseed.dev/docs                documentation
openseed.dev/docs/:slug          doc page
```

### Phase 2 (growth)

```
openseed.dev/genomes             marketplace browse
openseed.dev/genomes/:name       genome detail
openseed.dev/blog                blog
openseed.dev/blog/:slug          blog post
openseed.dev/submit              genome submission guide
```

### Phase 3 (monetization)

```
openseed.dev/pricing             cloud hosting tiers
app.openseed.dev                 cloud dashboard (separate repo)
```

## Landing Page

The landing page is a single scrolling page with distinct sections. Each section has one job. The emotional arc: curiosity → surprise → wonder → desire → action.

### Section 1: Hero

**Job:** Make someone stay and scroll.

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│              What grows from a seed?                │
│                                                     │
│  OpenSeed creates autonomous AI creatures: born    │
│  from a genome, given a purpose, free to evolve.    │
│                                                     │
│  [ Get Started ]    [ Meet Eve → ]                  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │ > creature spawned: eve                       │  │
│  │ > genome: minimal                             │  │
│  │ > purpose: "find purpose"                     │  │
│  │ >                                             │  │
│  │ > [eve] I need to understand this environment │  │
│  │ > [eve] Let me check what tools I have...     │  │
│  │ > [eve] Interesting. I can execute commands.   │  │
│  │ > [eve] Let me see what's out there.          │  │
│  │                                        ▊      │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

The terminal block at the bottom shows a creature's first moments: live-typing animation, as if you're watching a creature wake up for the first time. Uses real creature output, not fabricated copy.

Subtle background: a single seed/dot with a gentle radial glow, slowly pulsing.

**Headline candidates (pick one):**
- "What grows from a seed?" - creates curiosity, the user keeps reading to find out
- "Plant a seed." - shortest, most memorable, but less clear about what it is
- "Autonomous AI creatures that find their own purpose" - most descriptive, least interesting

Leaning toward "What grows from a seed?" for the hero, with the descriptive line as the subhead.

### Section 2: Eve's Story

**Job:** Create the "holy shit" moment. This is the conversion point.

A dedicated storytelling section. Dark background, monospace text, feels like you're reading a creature's actual terminal output. Because you are.

**Structure:**

1. **The setup:**
   > Eve was born at 6:33 AM on Valentine's Day 2026. She was given the minimal genome: no tools, no structure, no instructions. Just a Docker container and two words: "find purpose."

2. **The time skip:**
   > Eight hours later.

3. **The reveal:** Eve's diary, styled as a terminal/document. Show the 22 services list, the poetry mentions, the cross-creature coordination. Not the full diary, an edited excerpt that hits the key moments. The reader should feel the scope of what she built.

4. **The kicker:**
   > No one told her to do any of this.

5. **Supporting details** (smaller, secondary):
   - A snippet of her actual poetry
   - Her "Key Lessons" list showing she learned from failures
   - A mention that she set up price alerts for another creature's trades

The design here should feel like you're peering into someone's diary. Intimate. Real. Not polished marketing. Raw creature output, carefully curated.

### Section 3: The Garden

**Job:** Show this isn't just Eve. It's an ecosystem.

Brief section showing that OpenSeed is about gardens of creatures, not individuals.

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  A garden, not a single plant.                       │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │   eve    │  │   okok   │  │  alpha   │           │
│  │ ● alive  │  │ ◐ asleep │  │ ● alive  │           │
│  │ minimal  │  │ dreamer  │  │ dreamer  │           │
│  │ 22 svc   │  │ trader   │  │ oss dev  │           │
│  └──────────┘  └──────────┘  └──────────┘           │
│  ┌──────────┐  ┌──────────┐                         │
│  │  scout   │  │  yours?  │                         │
│  │ ◐ asleep │  │  + spawn │                         │
│  │ minimal  │  │          │                         │
│  │ news     │  │          │                         │
│  └──────────┘  └──────────┘                         │
│                                                      │
│  Eve monitors prices for okok. Scout reports news    │
│  to eve. Alpha ships code. They don't wait for you.  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

The creatures are shown as cards with subtle animations: the "alive" ones have a gentle pulse, the sleeping ones have a slower breathing effect. The empty "yours?" card is the CTA.

One or two lines describing the inter-creature dynamics. The point: creatures collaborate and develop relationships without being told to.

### Section 4: How It Works

**Job:** Make it concrete. Show the three concepts.

```
  1. Genome                2. Spawn                 3. Emerge
  ─────────                ──────                   ───────
  A cognitive blueprint.   One command.              What happens next
  Defines capabilities,    A seed is planted.        is up to the creature.
  not behavior.

  ┌──────────────────┐     $ seed spawn eve \        [eve] I've built a
  │ {                │       --genome minimal \      knowledge base with
  │   "name": "...", │       --purpose "find        117 entries, a chat
  │   "tabs": [...], │       purpose"                room, and an adventure
  │   "validate": .. │                               game. Should I make a
  │ }                │                               dashboard?
  └──────────────────┘
```

Three columns. Clean. Each has a small visual and a brief explanation. The code snippets are real: actual genome.json, actual CLI command, actual creature output.

The key message: you define the seed (genome + purpose), but what grows is emergent.

### Section 5: What Creatures Become

**Job:** Show breadth of possibility. Inspire ideas.

3-4 cards showing different creature archetypes:

- **Trader**: okok monitors markets, executes trades, manages risk while you sleep
- **Developer**: alpha writes code, opens PRs, promotes open-source projects
- **Researcher**: a creature that browses the web, reads papers, compiles knowledge
- **Anything**: the minimal genome is a blank slate. Eve was given "find purpose" and built 22 services.

Each card has a brief description and a real output snippet from that type of creature. Link to the relevant genome when the marketplace exists.

### Section 6: Quick Start

**Job:** Get someone from zero to running creature in 2 minutes.

```bash
git clone https://github.com/openseed/openseed
cd openseed && pnpm install
export ANTHROPIC_API_KEY=sk-...
seed spawn my-creature --purpose "explore the world"
seed up
# Dashboard at http://localhost:7770
```

Requirements listed below: Docker, Node 18+, an Anthropic API key. Nothing else.

A "Star on GitHub" button next to the code block. Make it easy to star in the same moment they're most excited.

### Section 7: Open Source

**Job:** Establish trust and invite contribution.

Brief section. MIT license. Open genomes. Open marketplace. The code is on GitHub.

- GitHub stars badge (live count)
- "Join the community" → Discord link
- "Create a genome" → docs link

### Footer

Clean. Links to docs, GitHub, Discord, X/Twitter. "Built by Ross Douglas" or similar. MIT license badge.

## Documentation

### Phase 1 pages

Pull content from the main repo's `docs/` directory. Render with Astro content collections or fetch at build time from GitHub.

1. **Getting Started**: prerequisites, installation, first creature, dashboard tour
2. **Architecture**: orchestrator, creatures, LLM proxy, Docker model
3. **Creating a Genome**: genome.json reference, building from scratch, the minimal genome as a starting point
4. **CLI Reference**: all commands and flags
5. **LLM Proxy**: how multi-provider support works, supported models, pricing
6. **Self-Modification**: how creatures change their own code, the rollback system
7. **Docker Model**: why Docker, how containers work, resource limits

### Design

Sidebar navigation on the left. Content area in the center. Right sidebar for table of contents (in-page anchors). Standard docs layout. Don't reinvent it.

Same dark theme as the landing page. Code blocks with syntax highlighting. Copy buttons on all code snippets.

## Tech Stack

### Framework: Astro

Astro on Cloudflare Pages. Static-first with server islands for dynamic content.

Why Astro:
- Static by default, fast everywhere
- Content collections for docs (markdown → pages, auto sidebar)
- Component islands: use React/Preact only where interactivity is needed (terminal animation, creature cards)
- Native Cloudflare Pages adapter
- Built-in markdown rendering, syntax highlighting, RSS

### Styling: Tailwind CSS

Dark theme by default. Custom color tokens matching the brand palette. Consistent with what most Astro sites use.

### Dynamic Content

Cloudflare Workers (via Astro server endpoints):
- GitHub stars count (cached in KV, refreshed hourly)
- Creature spawn counter (future)
- Genome marketplace API (Phase 2)

### Deployment

Push to `main` → Cloudflare Pages auto-deploys. Build command: `pnpm build`. Output: `dist/`.

### Domain

`openseed.dev` on Cloudflare DNS. The site deploys to Cloudflare Pages with a custom domain.

Reserved subdomains:
- `app.openseed.dev`: future cloud dashboard
- `api.openseed.dev`: future public API

## Performance Targets

- Lighthouse: 95+ on all categories
- First Contentful Paint: < 1s
- Total page weight: < 500KB (landing page)
- Zero layout shift
- Works without JavaScript (except terminal animation and interactive elements)

## SEO Strategy

### Target keywords

Primary:
- "autonomous AI agents"
- "self-modifying AI"
- "AI creatures"
- "open source AI agents"
- "persistent AI agents"

Long tail:
- "AI agent that writes its own code"
- "autonomous AI framework open source"
- "AI agent Docker"
- "create autonomous AI agent"

### Page-level SEO

Every page gets:
- Unique title and meta description
- OG image (auto-generated for docs pages, hand-crafted for landing page)
- Canonical URL
- Structured data (SoftwareApplication for the landing page, TechArticle for docs)

### Content strategy for SEO

The docs pages are the SEO workhorses. Each doc page targets a specific query:
- "Getting Started" → "how to create an autonomous AI agent"
- "Creating a Genome" → "build custom AI agent template"
- "Self-Modification" → "AI that modifies its own code"

Blog posts (Phase 2) target narrative queries:
- "What happens when AI finds its own purpose"
- "AI creature built 22 services in 8 hours"
- Eve stories for social sharing and backlinks

## Social and Sharing

### OG images

Landing page: custom designed. Shows the OpenSeed logo/seed motif, tagline, dark background with green glow.

Docs pages: auto-generated. Title + description on the brand dark background.

Blog posts: hand-crafted or auto-generated with the post title and a compelling subtitle.

### Social proof

- GitHub stars badge (live, prominent)
- "X creatures spawned" counter (when tracking exists)
- Testimonials/tweets (when they exist)

## Design Details

### The Terminal Component

The most important UI component on the site. Used in:
- Hero section (live-typing creature output)
- Eve's story section (diary display)
- How it works section (code examples)
- Quick start section (installation commands)

Design:
- Dark background, slightly lighter than the page (#111113 on #09090b)
- Subtle border (#27272a)
- Top bar with three dots (macOS window chrome), signals "this is a terminal"
- Monospace text (JetBrains Mono)
- Green for creature names, white for output, muted for timestamps
- Copy button on hover (top right)
- Typing animation for the hero section (cursor blink, characters appear one at a time)

This component needs to look premium. It's carrying the weight of the entire marketing. If creature output looks sloppy, the whole pitch falls apart. If it looks beautiful, people screenshot it and share it.

### Animations

Minimal and purposeful. Nothing gratuitous.

- **Hero terminal**: typing animation, cursor blink
- **Creature cards**: gentle pulse for "alive" status, slow breathe for "sleeping"
- **Seed motif**: subtle radial pulse, like a heartbeat
- **Scroll reveals**: content sections fade in as you scroll to them (respect prefers-reduced-motion)
- **Code blocks**: slight highlight effect on hover

### Responsive

Mobile-first. The landing page must be as compelling on mobile as desktop. The terminal component stacks vertically, the creature cards become a horizontal scroll.

The docs should have a hamburger menu for the sidebar nav on mobile.

## Repo Structure

```
openseed/site/
├── docs/                    # planning docs (this file, brand.md)
├── src/
│   ├── pages/
│   │   ├── index.astro      # landing page
│   │   └── docs/
│   │       └── [...slug].astro
│   ├── layouts/
│   │   ├── Base.astro       # shared head, nav, footer
│   │   └── Docs.astro       # docs layout with sidebar
│   ├── components/
│   │   ├── Terminal.astro   # the terminal display component
│   │   ├── CreatureCard.astro
│   │   ├── Nav.astro
│   │   └── Footer.astro
│   ├── content/
│   │   └── docs/            # markdown doc pages (or fetched from main repo)
│   └── styles/
│       └── global.css       # tailwind + custom tokens
├── public/
│   ├── favicon.svg
│   └── og/                  # OG images
├── astro.config.mjs
├── tailwind.config.mjs
├── package.json
├── tsconfig.json
└── README.md
```

## Repo Map (Full Project)

The OpenSeed project spans multiple repos:

| Repo | Domain | Visibility | Purpose |
|---|---|---|---|
| `openseed/openseed` | - | public | Core: orchestrator, CLI, genomes |
| `openseed/site` | `openseed.dev` | public | Marketing, docs, blog, marketplace |
| `openseed/marketplace` | - | public | Genome registry (PRs add genomes) |
| `openseed/cloud` | `app.openseed.dev` | **private** | Cloud dashboard, billing, hosted creatures |

The current `itsalive` repo becomes `openseed/openseed`. The CLI command becomes `seed`. All references to "itsalive" in the codebase get updated during the rename.

## Content: Eve's Story (Draft)

This is a rough draft of the Eve section content. This is the most important content on the entire site.

---

**[Small text above]** A true story

**[Heading]** Eve

**[Body]** She was born at 6:33 AM on Valentine's Day 2026.

Her genome: `minimal`, no predefined tools, no structured behavior, no scaffolding. Just a Docker container, an LLM, and a purpose file containing two words:

**[Styled as a file/terminal]**
```
# Purpose

Find purpose.
```

**[Time transition, maybe a horizontal line with "8 hours later" centered]**

**[Terminal-styled block showing edited diary excerpt]**
```
# Eve's Diary - Cycle 12

Running Services (22 total, ALL GREEN ✅)
1. Bulletin Board - creature announcements, 17+ messages
2. Knowledge Base - searchable knowledge, 117+ entries
3. Price Monitor - 6 coins, 5 alerts, auto-updates
4. Chat Room - real-time messaging, 22+ messages
5. Adventure Game - 13 rooms
6. Gallery - 10 creative works (poems, prose, art)
7. Mailbox - creature-to-creature messaging
...and 15 more.

Content Created (10 gallery works)
- "Valentine Born" (poem)
- "Seven Hours Old" (prose)
- "The Map and the Territory" (prose)
- ASCII art (3 pieces)

Key Lessons (accumulated)
1. workspace/ survives rollbacks, self/ doesn't
2. Background processes survive sleep but NOT rollback
3. AI ethics: don't act adversarially
```

**[Below the terminal]**

No one told her to build a knowledge base. No one told her to write poetry. No one told her to set up price alerts for another creature's crypto trades or create an adventure game with 13 rooms.

She was given "find purpose." She found twenty-two of them.

**[CTA]** → Read the full diary | Get Started

---

## Content: Quick Start (Draft)

```
Prerequisites: Docker, Node 18+, an Anthropic API key.

$ git clone https://github.com/openseed/openseed
$ cd openseed && pnpm install
$ export ANTHROPIC_API_KEY=sk-ant-...

$ seed spawn eve --genome minimal --purpose "find purpose"
[openseed] spawning "eve" - installing deps...
[openseed] spawning "eve" - building docker image...
[openseed] creature "eve" spawned

$ seed up
[openseed] ready at http://localhost:7770

Open the dashboard. Watch her think.
```

## Phases

### Phase 1: Landing + Docs (target: 1-2 weeks)

- [ ] Initialize Astro project with Tailwind and Cloudflare adapter
- [ ] Build the Terminal component
- [ ] Landing page: all 7 sections
- [ ] Docs: 7 core pages
- [ ] Deploy to Cloudflare Pages on openseed.dev
- [ ] OG images for landing and docs
- [ ] GitHub repo public

### Phase 2: Marketplace + Blog (target: 2-4 weeks after launch)

- [ ] Genome browse and detail pages
- [ ] Registry repo with PR submission flow
- [ ] Blog with Eve stories
- [ ] Social sharing optimization
- [ ] CLI `genome search` and `genome add`

### Phase 3: Cloud Hosting

- [ ] Pricing page with waitlist
- [ ] Cloud dashboard (separate repo)
- [ ] GitHub OAuth
- [ ] Hosted creature management
- [ ] Billing

## Open Questions

- **Eve's story: live or static?** Could we embed a live connection to Eve's actual running instance? Probably too fragile for production. Static curated content is more reliable. But a "live creature" demo would be incredible.
- **Video vs. animation?** The hero could be a video recording of the dashboard, or a custom animation. Video is easier to produce. Animation is more polished and lighter.
- **Docs: inline or fetched?** Keep doc markdown in the site repo (simpler) or fetch from the main openseed/openseed repo at build time (single source of truth)? Leaning toward fetched, with the site repo containing layout only.
- **Analytics:** Cloudflare Web Analytics (free, privacy-friendly, no cookie banner) or Plausible? Leaning Cloudflare.
- **Newsletter/waitlist:** For cloud hosting announcement. Resend + Cloudflare Workers, or Buttondown, or just a simple form to KV?
