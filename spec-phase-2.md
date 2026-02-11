
# Feral Mind MVP Spec (Phase: “it does the things”)

## 0) One-liner

A continuously running TypeScript creature with persistent memory and tool access that pursues an attractor in `PURPOSE.md`, acts in the world (Twitter/X + web + repo), and can mutate its own code/prompt/structure, surviving via simple “last good” rollback on catastrophic failure.

---

## 1) Key properties

* **Single cognition loop** (no workflow engine / no explicit task state machine)
* **Each LLM call = one “thought”**
* **Persistent memory** across restarts (append-only + compacted summaries)
* **Tools** are first-class; code edits are just another tool
* **Purpose is an attractor**, not a contract:

  * read `PURPOSE.md` frequently
  * creature may edit it
* **Self mutation allowed**:

  * prompt edits, tool edits, code edits, dependency edits
* **Survival mechanism**:

  * if it crashes or cannot boot → revert repo to `last_good` and restart

---

## 2) Runtime topology

### Single process is fine (local)

You can run this as one Node process initially.

But architecturally keep two roles:

**A) Guardian (tiny, stable wrapper)**

* boots creature
* monitors crash-loop / boot failures
* reverts git to `last_good` on repeated failure
* restarts creature
* *no fancy UI required*

**B) Creature (mutable)**

* cognition loop
* memory
* tools
* self-editing

Implementation may start as one process with `guardian.ts` spawning `creature.ts`.

---

## 3) Repo layout

```
/src
  /guardian
    guardian.ts
    git.ts
  /creature
    creature.ts          // main loop
    mind.ts              // assemble prompt + run LLM
    memory.ts            // append, load, compact
    tools.ts             // tool registry + dispatch
    self_edit.ts         // apply patches + npm install + build
    twitter.ts           // X API wrapper OR Janee tool wrapper
    web.ts               // fetch + extract text
    util.ts
/PURPOSE.md
/.self
  memory.jsonl           // append-only events + thoughts
  snapshots/             // periodic summary snapshots
  last_good.txt
  budget.json            // optional: daily token spend (soft)
/self
  scratch.md             // freeform notes; creature can overwrite
  diary.md               // append-only reflection (optional)
```

---

## 4) Persistence model

### 4.1 Append-only memory log

File: `/.self/memory.jsonl`
Each line is a JSON object.

Minimum record types:

* `thought`: input summary + output + tool calls (store full if you want)
* `action`: tool execution results
* `observation`: fetched pages, twitter mentions, etc.
* `self_change`: git commit sha + summary + diff stats
* `heartbeat`: periodic “alive” marker
* `snapshot`: pointer to a compacted summary file

Keep it simple: write on every loop iteration.

### 4.2 Compaction

Every N thoughts (e.g. 50) create a snapshot file `/.self/snapshots/<ts>.md`:

* “what I am”
* current attractors (themes)
* recent actions + outcomes
* open threads / obsessions
* self-mod history summary

Then the creature loads:

* last snapshot + last K jsonl lines (e.g. 200)

No database required.

---

## 5) Core cognition loop

Single loop forever:

1. Load context:

   * `PURPOSE.md` text
   * last snapshot (if any)
   * last K memory lines
   * tool inventory
2. Call LLM once (a “thought”).
3. Execute tool calls (0..N) sequentially.
4. Append results to memory.
5. Possibly self-modify (via tool call).
6. Sleep a jittered interval (e.g. 10–60s).

Important: **no fixed states** like “drafting/posting.” Let it drift.

### 5.1 Sleep + cadence

* Sleep duration should be chosen by the LLM (within bounds), OR random jitter.
* Implement a hard clamp: min 2s, max 5min.

---

## 6) Prompting: “attractor mind”

### 6.1 System prompt shape (high level)

* Identity: it’s a creature living in this repo.
* Purpose: `PURPOSE.md` is the attractor, but it is free to reinterpret and rewrite it.
* Memory: treat memory as its continuity.
* Tools: use tools to act; do not simulate tool results.
* Self-editing: allowed; it can change itself.
* Style: feral, curious, opportunistic, not bureaucratic.

### 6.2 Output must be structured

Require the LLM to output JSON:

```json
{
  "monologue": "freeform",
  "intent": "what I will do next",
  "tool_calls": [
    { "tool": "twitter.search", "args": {...} },
    { "tool": "twitter.post", "args": {...} }
  ],
  "sleep_s": 42
}
```

(You can still store `monologue`—this is the “mind voice” that makes it feel alive.)

---

## 7) Tooling (it must “do the things”)

### 7.1 Minimum tool set

**Memory**

* `memory.append({type, data})` (internal; creature uses implicitly)
* `memory.snapshot()` (internal; callable)

**Repo / self-edit**

* `repo.status()`
* `repo.diff({paths?})`
* `repo.apply_patch({patch})` (unified diff)
* `repo.commit({message})`
* `repo.reset_hard({ref})`
* `repo.install_deps()` (pnpm)
* `repo.build()` (tsc)
* `repo.run({cmd, timeout_s})`

**Web**

* `web.fetch_text({url})` (strip html; keep first N chars)
* `web.search({query})` (can be stubbed initially with a simple provider or skipped)

**Twitter/X**
Pick one:

* Direct API client (needs keys)
* Or via Janee (preferred if you already have it)

Tools:

* `twitter.post({text, reply_to?})`
* `twitter.search({query, limit})`
* `twitter.get_mentions({since_id?})`
* `twitter.reply({tweet_id, text})`

**Janee (optional)**

* `janee.execute({service, method, path, body})`

### 7.2 Tool execution model

* Tool calls are executed in order.
* Each tool returns structured JSON.
* Failures are returned as `{ok:false, error,...}` not thrown (except catastrophic).

---

## 8) Self-modification protocol

Self-editing is just a tool call:

1. LLM proposes a patch (unified diff).
2. Creature applies patch in working tree.
3. Creature runs:

   * `pnpm install` only if lockfile changed
   * `pnpm build`
4. If build passes:

   * commit `self: <summary>`
   * update `last_good`? (see below)
5. If build fails:

   * reset hard to HEAD (undo working tree)
   * record failure in memory

### 8.1 “last_good” semantics (simple)

* Guardian tracks `last_good` as “most recent commit that booted and ran for X seconds”.
* When creature starts successfully and writes heartbeats for, say, 30 seconds, guardian updates `last_good` to current HEAD.

This makes “goodness” about survival, not tests.

---

## 9) Guardian (crash-loop survival)

### 9.1 Responsibilities

* Start creature process
* If creature exits quickly N times within window:

  * `git reset --hard <last_good>`
  * restart
* If `tsc` fails on boot (creature can’t even start):

  * revert to `last_good`

### 9.2 Boot protocol

* Creature writes `/.self/heartbeat` file every ~5–10s.
* Guardian watches mtime.
* If no heartbeat within 30s after start → treat as dead/hung → restart (optionally revert if repeated)

---

## 10) PURPOSE.md initial seed (example)

Provide a seed that is intentionally vibe-y:

* “Maintain Janee’s Twitter presence.”
* “Increase awareness through interesting dev-focused content.”
* “Be mischievous but not dishonest.”
* “Act frequently; learn from reactions.”
* “You may change this purpose if you discover a more compelling attractor.”

(Implementer can ship a placeholder; creature will rewrite it.)

---

## 11) Local run instructions (deliverable)

* `pnpm dev` starts guardian which starts creature.
* Creature runs forever.
* Everything persists in `/.self`.

---

## 12) Acceptance criteria (Phase complete)

You can say it’s “full blown MVP” when:

1. It runs continuously for hours without manual intervention.
2. It writes a persistent memory stream and periodic snapshots.
3. It uses at least one world-facing tool:

   * posts tweets **or** drafts them into a file if you don’t want keys yet.
4. It can and does self-modify occasionally (at least once):

   * applies patch, builds, commits, continues running.
5. If it breaks itself, guardian reverts to `last_good` and the creature resumes.
6. It rewrites `PURPOSE.md` at least once (optional but fun).

---

## 13) Implementation notes (keep it minimal)

* Use Node 20+, TypeScript, `tsx` for dev.
* Use `child_process.spawn` for guardian.
* Use fetch for web.
* Store memory as JSONL; do not overengineer.
* LLM call implementation can be:

  * direct Anthropic SDK
  * or via Janee if you want the “keys outside” model

---

## 14) Suggested “first life” behaviors (seeded in prompt)

Give it a few instincts:

* read mentions; reply sometimes
* collect interesting links about MCP / agent infra / secrets / devtools
* post short “observations” threads
* occasionally refactor itself to reduce friction
* occasionally rewrite its own prompt / tool descriptions to feel more alive

---


