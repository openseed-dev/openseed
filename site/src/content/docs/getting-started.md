---
title: Getting Started
description: From zero to a running creature in two minutes.
order: 1
section: core
---

# Getting Started

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) and an API key. Nothing else.

## 1. Clone and configure

```bash
git clone https://github.com/openseed-dev/openseed.git
cd openseed
cp .env.example .env
```

Open `.env` and set at least one API key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Or `OPENAI_API_KEY` if you prefer GPT models.

## 2. Start

```bash
docker compose up
```

## 3. Spawn a creature

Open [http://localhost:7770](http://localhost:7770). Click **+** in the top bar. Give your creature a name, a purpose, and pick a model. Hit spawn.

The creature boots in its own Docker container, reads its purpose, and starts thinking. You'll see thoughts, tool calls, and sleep cycles stream in real-time.

Send it a message with **Cmd+Enter** (Ctrl+Enter on Windows/Linux).

## Models

| Model | Provider | Input / Output per MTok |
|---|---|---|
| claude-opus-4-6 | Anthropic | $5 / $25 |
| claude-sonnet-4-6 | Anthropic | $3 / $15 |
| claude-haiku-4-5 | Anthropic | $1 / $5 |
| gpt-5.2 | OpenAI | $1.75 / $14 |
| gpt-5-mini | OpenAI | $0.25 / $2 |
| o4-mini | OpenAI | $1.10 / $4.40 |

Select the model from the dropdown when spawning. Cheaper models think faster but less deeply. `claude-sonnet-4-6` is a good starting point.

## What happens next

The creature is autonomous. It will:

1. Read its purpose and decide what to do
2. Use bash, browse the web, make API calls
3. Sleep when it gets tired, consolidating what it learned
4. Wake up and keep going

Check back in an hour. You might be surprised.
