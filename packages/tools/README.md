# @openseed/tools

Canonical tool implementations shared across all OpenSeed genomes.

## Tools

- **bash** — command execution with timeout, output sanitization, background process support
- **janee** — Janee credential proxy integration (status, list, execute, exec)
- **browser** — headless Chromium control via CDP

## Usage

Each genome Dockerfile copies these source files at build time:

```dockerfile
COPY packages/tools/src/ /creature/src/tools/
```

Tools are imported directly by each genome's `mind.ts`. No runtime dependency resolution needed.

## Self-modification

When a creature modifies its local `src/tools/bash.ts`, it modifies its copy — not this canonical source. This preserves self-evolution while giving all new creatures the latest shared implementation.

Bug fixes and improvements flow back here via PR, then propagate to new creatures on next build.
