# Marketplace Site

Design doc for the openseed genome marketplace — a browse/search/submit site powered by a public registry repo and Cloudflare.

## Architecture

Two components that work together:

### 1. Registry Repo (`openseed/marketplace`)

A public GitHub repo that is the source of truth for listed genomes. Each genome is a tiny JSON file in `registry/`:

```
openseed/marketplace/
├── registry/
│   ├── dreamer.json
│   ├── minimal.json
│   ├── researcher.json
│   └── ...
├── site/                    # Cloudflare Pages app
├── .github/workflows/
│   └── validate.yml         # PR validation
└── README.md
```

A registry entry is minimal — just a pointer to the genome's actual repo:

```json
{
  "repo": "github:someone/genome-researcher",
  "featured": false,
  "added": "2026-02-16"
}
```

Everything else (name, description, tags, stars, README) is pulled live from the genome repo's `genome.json` and GitHub API. The registry doesn't duplicate metadata.

### 2. Cloudflare Pages + Workers Site

The marketplace website. Cloudflare Pages hosts the frontend, Workers handle the API, KV caches enriched genome data.

```
User → Cloudflare Pages (static frontend)
              ↓
       Cloudflare Worker (API)
              ↓
       Cloudflare KV (cached genome data, 1hr TTL)
              ↓
       GitHub API (stars, README, genome.json)
```

## Data Flow

### Indexing

A Worker function runs on a cron schedule (hourly):

1. Reads all `registry/*.json` files from the repo (via GitHub API or raw.githubusercontent.com)
2. For each entry, fetches from the genome repo:
   - `genome.json` (name, description, version, tags, tabs, permissions)
   - Star count, last commit date, contributor count (GitHub API)
   - README.md content (for detail pages)
3. Writes the enriched data to KV, keyed by genome name

### Serving

Site pages read from KV. No GitHub API calls at request time. Fast everywhere.

The browse page reads a sorted list from KV. The detail page reads a single genome's enriched entry. Search filters client-side for v1 (genome count will be small).

## Pages

### Browse (`/`)

Grid of genome cards. Each card shows:

- Genome name
- One-line description
- Tags (clickable, filter by tag)
- GitHub stars
- "Creatures spawned" count (if we track it)
- Author

Featured genomes pinned at the top. The rest sorted by stars or recently added.

Filter bar: tag filter, search box, sort dropdown (stars / newest / most spawned).

### Genome Detail (`/genome/:name`)

Full genome page. The landing page for a genome — this is what gets shared on Twitter, indexed by Google.

- Rendered README (the genome author controls this content)
- Sidebar: install command, version, author, license, star count, tags, last updated
- Tabs section showing what the dashboard will display (from genome.json tabs)
- Permissions badge row (network, browser, API keys needed)
- "Spawn" section: CLI command to spawn, deep-link to dashboard if running locally
- Version history (git tags from the genome repo)

### Submit (`/submit`)

Instructions for submitting a genome:

1. Create your genome repo with a valid `genome.json`
2. Fork `openseed/marketplace`
3. Add `registry/your-genome.json` with your repo URL
4. Open a PR

The page includes a validator: paste your repo URL, it checks `genome.json` is valid and shows what the card will look like. Reduces back-and-forth on PRs.

## Submission Flow

### The PR process

1. Contributor creates `registry/my-genome.json` in a PR
2. GitHub Action `validate.yml` runs:
   - Parses the JSON, extracts repo URL
   - Fetches `genome.json` from the repo
   - Validates required fields (name, version, description, author, license)
   - Checks no naming conflict with existing entries
   - Posts a comment: "Validated: **researcher** v2.1.0 — Deep research agent with web browsing"
3. If validation fails, the Action comments with specific errors
4. Maintainer reviews code quality / legitimacy, merges
5. Merge triggers site rebuild via Cloudflare Pages deploy hook
6. Genome appears on the site within minutes

### Validation rules

- `genome.json` must exist at repo root
- Required fields: `name`, `version`, `description`, `author`, `license`
- `name` must match the registry filename (e.g., `researcher.json` → `name: "researcher"`)
- `name` must be lowercase, alphanumeric + hyphens, 2-32 chars
- `version` must be valid semver
- Repo must be public
- No duplicate names (first-come-first-served)

## SEO and Social

Every genome detail page needs to be a good landing page:

- **Title**: `{name} — openseed genome marketplace`
- **OG image**: Auto-generated card with genome name, description, tags, star count. Use Cloudflare Workers + @cloudflare/pages-plugin-sentry or a simple SVG→PNG pipeline.
- **OG description**: The genome's description field
- **Canonical URL**: `https://marketplace.openseed.dev/genome/{name}`

These pages should rank for queries like "autonomous trading agent", "AI research agent", "self-modifying AI".

## Growth Mechanics

### "Built with openseed" badges

Genome authors embed a badge in their repo README:

```markdown
[![openseed genome](https://marketplace.openseed.dev/badge/{name}.svg)](https://marketplace.openseed.dev/genome/{name})
```

The badge is served by a Worker — dynamic SVG showing the genome name and spawn count. Every genome repo becomes a funnel back to the marketplace.

### Spawn count tracking

When a creature is spawned, the orchestrator can optionally ping the marketplace:

```
POST https://marketplace.openseed.dev/api/spawn
{ "genome": "researcher", "version": "2.1.0" }
```

No PII, no creature details — just a counter. Opt-in via `openseed` config. Powers the "X creatures spawned" stat on genome pages.

The counter lives in Cloudflare KV or D1. Simple increment.

### Social sharing

Genome detail pages have share buttons. But more importantly, the OG metadata means pasting a genome URL into Twitter/LinkedIn/Discord renders a rich card with the genome's name, description, and stats. Make sharing effortless.

## CLI Integration

### `openseed genome search`

```bash
$ openseed genome search "trading"
  trader       ★ 142  Autonomous crypto trading with risk management
  degen        ★ 38   High-frequency memecoin scalper
  quant        ★  24   Quantitative analysis and backtesting

$ openseed genome search --tag browser
  researcher   ★ 89   Deep research with web browsing
  monitor      ★ 56   Website monitoring and alerting
```

Queries the marketplace API: `GET https://marketplace.openseed.dev/api/genomes?q=trading`

### `openseed genome add`

```bash
$ openseed genome add researcher
Fetching researcher from github:someone/genome-researcher...
Installed researcher v2.1.0 to genomes/researcher/
```

The CLI resolves the genome name via the marketplace API, gets the repo URL, clones it.

## Tech Stack

### Frontend

Astro on Cloudflare Pages. Reasons:

- Static-first with server islands for dynamic content
- Native Cloudflare Pages adapter
- Fast builds, good DX
- Markdown rendering built in (for genome READMEs)
- Lightweight — no React/Vue runtime needed

If Astro feels heavy, even a vanilla HTML + Tailwind site with Workers functions would work for v1. The pages are simple.

### Backend

Cloudflare Workers for all API endpoints:

- `GET /api/genomes` — list/search genomes (reads from KV)
- `GET /api/genomes/:name` — genome detail (reads from KV)
- `POST /api/spawn` — spawn counter (writes to KV)
- `GET /badge/:name.svg` — dynamic badge

### Storage

- **Cloudflare KV**: Cached genome data (enriched from GitHub). 1-hour TTL on the index worker's refresh. Spawn counters.
- **Cloudflare D1** (optional, if we need relational queries later): spawn events, user accounts, analytics.

For v1, KV is sufficient. D1 can come later if we add user accounts or richer analytics.

### Domain

`marketplace.openseed.dev` or `genomes.openseed.dev`. Cloudflare DNS.

## Security

- Registry PRs are reviewed by maintainers before merge. No auto-merge.
- The validation Action only reads from the genome repo — no code execution.
- The spawn counter endpoint is rate-limited and accepts no sensitive data.
- Genome repos are public — users can audit the code before spawning.
- The marketplace never handles API keys or credentials.

## Phases

### Phase 1: Registry + Static Site

- Create `openseed/marketplace` repo
- Seed with dreamer and minimal
- Validation GitHub Action
- Static Cloudflare Pages site: browse and detail pages
- Manual data refresh (rebuild on merge)

### Phase 2: Live Data + API

- Cloudflare Worker for GitHub data enrichment
- KV caching with hourly refresh
- Search/filter on browse page
- CLI `genome search` and `genome add` commands
- Badge endpoint

### Phase 3: Social + Growth

- OG image generation
- Spawn count tracking
- Share buttons and rich cards
- "Built with openseed" badge kit
- Featured genome rotation

### Phase 4: Community

- Genome ratings/reviews
- "Creatures from this genome" showcase (opt-in)
- Creature divergence analytics ("average creature from this genome self-modifies 3.2x/day")
- Auto-discovery of unregistered genomes via GitHub topic (community tab)

## Open Questions

- **Custom domains for the marketplace?** `openseed.market`? `genomes.openseed.dev`? Keep it under the main domain for SEO juice.
- **User accounts?** Not for v1. But if we add ratings/reviews, we'll need GitHub OAuth. Cloudflare Access makes this trivial.
- **Genome categories vs. tags?** Tags are more flexible. Start with tags, add categories later if the taxonomy stabilizes.
- **Auto-update notifications?** Should the CLI or dashboard notify when an installed genome has a new version? Useful but not v1.
