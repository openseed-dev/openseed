
## MVP goal

Run a self-editing TS “creature” that can change its own repo and restart, while a separate “host”:

* supervises it (start/stop/crash-loop)
* provides a live event stream + minimal UI
* promotes last-good / rolls back on failed health
* optionally routes “LLM calls” through Janee (or stubs them)

You should be able to see: *what it tried, what diff it made, what checks ran, why it rolled back.*

---

# 1) Local architecture

**Two node processes** in the same repo to start:

1. **host** (stable-ish, you don’t let the creature edit it in MVP)

* runs on `localhost:7777`
* spawns creature as a child process
* writes events to `./.self/host.db` (sqlite) or `./.self/events.jsonl`
* owns rollback + promotion logic
* exposes:

  * SSE stream of events
  * web page that tails events + shows “last good / current”

2. **creature** (mutable)

* runs on `localhost:7778`
* provides `/healthz`
* on boot, does a single “iteration”:

  * decide a tiny change
  * apply it (edit a file)
  * run `pnpm test` (or a smoke script)
  * commit
  * ask host to restart into new HEAD
* emits structured events to host (`POST /events`)

**Janee (optional for MVP)**

* you run Janee locally (or use your normal Janee setup)
* creature calls Janee for “LLM” *or* you stub LLM with a local fake
* host does not need secrets either; Janee holds them

MVP works even without Janee by using a stub “LLM” that returns deterministic patch suggestions.

---

# 2) Repo layout

```
/src
  /host
    index.ts          // supervisor + event store + UI + rollback
    git.ts            // minimal git helpers
    events.ts         // append-only event writer + SSE
  /creature
    index.ts          // tiny web server + one iteration loop
    evolve.ts         // makes a patch (stubbed at first)
    apply.ts          // apply patch + run checks + git commit
  /shared
    types.ts          // Event types
/self
  plan.md             // creature reads this (optional)
  diary.md            // creature appends reflections
/.self
  events.jsonl        // host-owned append-only
  last_good.txt       // commit sha
```

---

# 3) Event schema (minimum)

Everything is an event. Host stores + streams them.

```ts
type Event =
  | { t: string; type: "host.boot"; }
  | { t: string; type: "host.spawn"; pid: number; sha: string; }
  | { t: string; type: "host.promote"; sha: string; }
  | { t: string; type: "host.rollback"; from: string; to: string; reason: string; }
  | { t: string; type: "creature.boot"; sha: string; }
  | { t: string; type: "creature.intent"; text: string; }
  | { t: string; type: "creature.patch"; summary: string; files: string[]; }
  | { t: string; type: "creature.checks"; cmd: string; ok: boolean; ms: number; out_tail?: string; }
  | { t: string; type: "creature.request_restart"; sha: string; };
```

That’s enough to “watch it.”

---

# 4) Host behavior (spec)

### Endpoints

* `GET /`
  Minimal HTML page that:

  * opens SSE `/events`
  * shows a scrolling log
  * shows `current_sha`, `last_good_sha`, `pid`, `status`

* `GET /events` (SSE)
  streams every event line as it’s appended.

* `POST /event`
  creature sends events here (host validates + appends).

* `POST /restart`
  body `{ sha: string }` – creature requests restart into current HEAD.
  Host:

  1. kill creature
  2. start creature again
  3. begin health gate

* `GET /status`
  `{ current_sha, last_good_sha, pid, healthy }`

### Health gating

* after spawn/restart, poll `http://127.0.0.1:7778/healthz`
* require **healthy for N seconds** (e.g. 10s) to promote:

  * set `last_good_sha = current_sha`
  * write `/.self/last_good.txt`

### Rollback

If within a window (e.g. 30s) it:

* never becomes healthy, OR
* crash-loops (process exits), OR
* returns unhealthy,
  then:
* `git reset --hard <last_good_sha>`
* restart creature
* emit `host.rollback`

> Note: for MVP, keep it single-worktree. Later you can do worktrees.

---

# 5) Creature behavior (spec)

### Endpoints

* `GET /healthz`
  return 200 only if:

  * server is running
  * and a “smoke” file exists: `/.self/boot-ok` written during boot

* `POST /tick` (optional)
  manually trigger one iteration.

### On boot: run one iteration (MVP)

1. Emit `creature.boot`
2. Decide a small patch:

   * **MVP patch idea:** update `/self/diary.md` and tweak a harmless string in code, OR add a tiny test.
3. Apply patch
4. Run checks:

   * start with `pnpm -s test` where test is trivial
5. If checks pass:

   * `git add -A && git commit -m "self: <summary>"`
   * emit `creature.request_restart` with new sha
   * call `POST http://127.0.0.1:7777/restart {sha}`
6. If checks fail:

   * emit `creature.checks ok:false`
   * exit with non-zero (forces host rollback behavior)
   * append failure note to `/self/diary.md`

### LLM hookup (optional in MVP)

Replace “decide a small patch” with:

* call Janee `execute` for an Anthropic request
* parse returned suggestion into a patch (even just “edit diary”)

But you can fully validate the architecture without LLM first.

---

# 6) The absolute minimum “tests”

Make tests deterministic so you can see rollback:

* `pnpm test` runs a script that asserts a string exists somewhere.
* Have the creature occasionally “break” it (e.g. every 3rd run) to prove rollback works.

Example invariant:

* `src/shared/version.ts` exports `export const VERSION = "x";`
* test ensures it matches `/^v\d+\.\d+$/`
* creature sometimes writes `VERSION="lol"` → test fails → host rolls back

---

# 7) Local run commands

* `pnpm dev:host` (starts host on 7777)
* `pnpm dev:creature` (host spawns creature; creature doesn’t run standalone in MVP)

Then open `http://localhost:7777` and watch the timeline.

---

# 8) MVP acceptance criteria

You’re “done” when you can demonstrate, locally:

1. Creature makes a commit and asks for restart.
2. Host restarts into the new commit.
3. If the new commit breaks health/tests, host rolls back to last_good automatically.
4. The UI shows the full story: intent → patch → checks → restart → promote/rollback.
5. Creature never has API keys (if you include Janee).

---

