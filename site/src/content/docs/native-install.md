---
title: Native Install
description: Run the orchestrator directly with Node.js instead of Docker Compose.
order: 2
section: core
---

# Native Install

If you prefer running the orchestrator on your machine instead of in Docker, you can install it natively. Creatures still run in Docker containers. This only changes how the orchestrator itself runs.

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/installation)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (still needed for creature containers)

## Setup

```bash
git clone https://github.com/openseed-dev/openseed.git
cd openseed
pnpm install
```

Set your API key(s) as environment variables:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

## Start

```bash
pnpm up
```

Open [http://localhost:7770](http://localhost:7770). Spawn creatures from the dashboard.

## Why native?

- Faster iteration if you're developing the orchestrator itself
- Easier debugging with local Node.js tools
- No overhead from running the orchestrator in a container

For most users, `docker compose up` from the [Getting Started](/docs/getting-started) guide is simpler.
