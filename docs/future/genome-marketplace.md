# Genome Marketplace

## Core Idea

Genomes are git repos. The marketplace is a discovery layer on top of git.

No custom registry, no package manager, no upload flow. A genome is a public repo that follows a convention. The marketplace indexes them, the CLI fetches them, the dashboard lets you browse and spawn.

## Genomes as Git Repos

A genome repo looks like this:

```
genome-researcher/
  genome.json       # manifest
  README.md         # what this creature does, example output
  LICENSE
  package.json
  Dockerfile        # creature container image
  src/
    mind.ts         # cognitive loop
    index.ts        # entry point
    tools/          # domain-specific tools
  PURPOSE.md        # default purpose (overridable at spawn)
```

Publishing a genome = pushing a repo with a valid `genome.json`. That's it.

## genome.json Manifest

Current fields plus marketplace additions:

```json
{
  "name": "researcher",
  "version": "2.1.0",
  "description": "Deep research agent with web browsing and paper analysis",
  "author": "someone",
  "license": "MIT",
  "repository": "https://github.com/someone/genome-researcher",
  "homepage": "https://someone.dev/researcher",
  "tags": ["research", "browser", "academic"],
  "validate": "npx tsx --check src/mind.ts",
  "tabs": [
    { "id": "notes", "label": "notes", "file": "self/notes.md", "type": "markdown" },
    { "id": "sources", "label": "sources", "file": ".self/sources.jsonl", "type": "jsonl", "limit": 20 }
  ],
  "permissions": {
    "network": true,
    "browser": true,
    "apiKeys": ["SERP_API_KEY"]
  },
  "minHostVersion": "0.5.0"
}
```

### Field notes

- **repository**: The canonical git URL. The marketplace indexes from this.
- **tags**: Free-form. Used for search and filtering.
- **permissions**: Declared capabilities the genome needs. The orchestrator enforces these at spawn time. A genome that doesn't declare `network: true` gets no outbound access.
- **permissions.apiKeys**: API keys the creature needs beyond the LLM key. The orchestrator prompts the user for these at spawn time and injects them as env vars.
- **minHostVersion**: Minimum itsalive version required. Prevents spawning on incompatible hosts.

## CLI Workflow

### Installing genomes

```bash
# Add a genome from GitHub
itsalive genome add github:someone/genome-researcher

# Add a specific version
itsalive genome add github:someone/genome-researcher@v2.1

# Add from any git URL
itsalive genome add https://gitlab.com/someone/genome-researcher.git

# List installed genomes
itsalive genome list

# Update to latest
itsalive genome update researcher

# Remove
itsalive genome remove researcher
```

`genome add` clones the repo into `genomes/<name>/`. The name comes from `genome.json`. If there's a conflict, the CLI asks.

### Spawning from remote genomes

```bash
# Spawn directly from a URL (auto-fetches and caches)
itsalive spawn my-researcher --genome github:someone/genome-researcher

# Spawn from a locally installed genome
itsalive spawn my-researcher --genome researcher

# With purpose override
itsalive spawn my-researcher --genome researcher --purpose "Survey recent papers on RLHF"
```

If the genome isn't installed locally, the CLI fetches it, caches it, then spawns. Subsequent spawns from the same genome use the cache.

### Searching

```bash
# Search the marketplace
itsalive genome search "trading"
itsalive genome search --tag browser
```

This queries the marketplace index (see below).

## Versioning and Pinning

Git tags are genome versions. The `version` field in `genome.json` should match the latest tag.

When you spawn a creature, `BIRTH.json` records the exact commit SHA:

```json
{
  "genome": "researcher",
  "genome_version": "2.1.0",
  "genome_sha": "abc123...",
  "genome_repo": "https://github.com/someone/genome-researcher"
}
```

This lets you trace any creature back to the exact genome code it was born from, even if the genome has since been updated.

## Creature Divergence

When a creature is spawned, it gets a copy of the genome's code. Over time, it self-modifies. The diff between the genome and the creature's current state IS the creature's learned behavior:

```bash
cd ~/.itsalive/creatures/my-researcher
git diff genome-v2.1..HEAD
```

This is the phenotype — what the creature became vs. what it started as. Two creatures from the same genome, given different purposes, produce different diffs. The genome community could study these diffs to improve the genome itself.

### Contributing back

If a creature discovers a useful self-modification, the owner could extract it and PR it back to the genome repo. This closes the loop: genome → creature → evolution → genome improvement.

## Permissions and Trust

### Enforced permissions

The orchestrator reads `permissions` from `genome.json` at spawn time:

- **network**: If `false`, the creature container gets `--network none`.
- **browser**: If `false`, the Playwright/browser tools are disabled.
- **apiKeys**: The orchestrator prompts for these at spawn time. They're injected as env vars into the container but never stored in the genome or creature code.
- **maxCostPerDay**: Optional spending cap. The proxy enforces this.

### Trust model

Genomes are open source by nature — the user can read the code before spawning. Trust signals:

1. **Code review**: It's a git repo. Read the source.
2. **Community**: Stars, forks, contributor count, issue activity.
3. **Verified authors**: The marketplace could verify well-known authors.
4. **Audit history**: Every genome change is a git commit. You can see exactly what changed between versions.
5. **Spawn count**: How many creatures have been spawned from this genome (opt-in telemetry).

## Marketplace Architecture

The marketplace is a thin discovery layer, not a hosting platform. Three components:

### 1. The Index

A service that crawls GitHub (and optionally GitLab, etc.) for repos with an `itsalive-genome` topic and a valid `genome.json`. It builds a searchable index of:

- Genome name, description, tags
- Author, stars, last updated
- Version history
- README content (for the detail page)

Updated periodically (hourly or on webhook).

### 2. The Website

A browse/search/detail UI. Think npm but for genomes. Each genome page shows:

- README (rendered)
- genome.json metadata
- Install command
- Version history
- Star count and community stats
- "Spawn" button (deep-links to the dashboard if running locally)

### 3. The CLI Integration

The CLI queries the index for `genome search`. The dashboard's "browse genomes" tab uses the same API.

## Genome Composition (Future)

A genome could extend another:

```json
{
  "name": "crypto-dreamer",
  "extends": "github:itsalive/genome-dreamer@v3.0",
  "description": "Dreamer with crypto trading tools",
  "additions": {
    "tools": ["src/tools/exchange.ts"]
  }
}
```

This is complex and can wait. Mentioning it here because the manifest schema should leave room for it.

## Phases

**Phase 0 (now):** Genomes are local directories. Two bundled genomes (dreamer, minimal). `genome.json` manifest exists.

**Phase 1:** CLI supports `github:user/repo` as a genome source. `genome add`, `genome list`, `genome remove` commands. BIRTH.json records genome repo and SHA.

**Phase 2:** Marketplace website. Index service crawls GitHub for `itsalive-genome` repos. Browse, search, detail pages. `genome search` in CLI.

**Phase 3:** Dashboard integration. Browse genomes tab. One-click spawn from the web UI. Permission prompts for API keys.

**Phase 4:** Community features. Spawn counts, creature divergence analytics, "creatures from this genome" gallery, genome improvement PRs from creature evolution.

## Open Questions

- **Genome naming conflicts**: Two repos could claim the same `name` in `genome.json`. First-come-first-served? Scoped names like `@someone/researcher`?
- **Private genomes**: Should the CLI support private repos? Probably yes (via SSH keys or GitHub tokens). The marketplace only indexes public repos.
- **Genome signing**: Should genome releases be signed? Adds trust but adds friction. Probably not for v1.
- **Monetization**: Should genome authors be able to charge? Probably not — keep the ecosystem open. But the permissions model could support "requires API key for service X" which is indirect monetization.
