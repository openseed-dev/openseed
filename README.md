# itsalive

A minimal self-modifying agent that can edit its own code and restart safely with automatic rollback.

## What it does

This MVP demonstrates a "creature" (autonomous agent) that can:
- Make small edits to its own codebase
- Run tests to verify changes
- Commit and request restart
- Get promoted by a supervisor after proving stability
- Automatically rollback when changes break tests

## Architecture

**Two processes:**

1. **Host** (port 7777) - Stable supervisor that:
   - Spawns and manages the creature process
   - Stores all events in `.self/events.jsonl`
   - Serves a real-time UI showing system state
   - Promotes working commits after 10s of healthy operation
   - Rolls back to last known-good commit on failure

2. **Creature** (port 7778) - Mutable agent that:
   - Makes small patches to the codebase
   - Runs `pnpm test` to validate changes
   - Commits and requests restart on success
   - Exits on failure, triggering rollback

## Running the system

**Auto-iteration mode (SPEC-compliant):**
```bash
# Start with auto-iteration on boot
pnpm dev:host

# Open the UI in your browser
open http://localhost:7777
```

The creature will automatically iterate on each boot, continuously evolving.

**Manual mode (for testing/observation):**
```bash
# Start with manual iteration control
pnpm dev:host:manual

# Trigger iterations manually
curl -X POST http://localhost:7778/tick
```

The UI shows:
- Current commit SHA
- Last known-good commit SHA
- Process PID and health status
- Real-time event stream of all actions

## Iteration behavior

Each iteration:
1. Decides on a small patch (usually appends to `self/diary.md`)
2. Applies the patch
3. Runs tests
4. If tests pass: commits and requests restart
5. If tests fail: exits, triggering automatic rollback

## Testing rollback

The system intentionally breaks on every 3rd iteration to demonstrate rollback.

**Manual test:**
```bash
# Start in manual mode
pnpm dev:host:manual

# First iteration: appends to diary (succeeds)
curl -X POST http://localhost:7778/tick
sleep 15

# Second iteration: appends to diary (succeeds)
curl -X POST http://localhost:7778/tick
sleep 15

# Third iteration: breaks version.ts (fails, triggers rollback)
curl -X POST http://localhost:7778/tick
```

**Automated test:**
```bash
pnpm test:rollback
```

Watch the UI to see:
- `creature.intent` - what it plans to do
- `creature.patch` - what files it modified
- `creature.checks` - test results
- `host.promote` - commit was promoted to last_good
- `host.rollback` - automatic revert on failure

## Files

```
/src/host/          # Supervisor process
  index.ts          # Main host server
  events.ts         # Event store + SSE streaming
  git.ts            # Git helpers (promote/rollback)

/src/creature/      # Mutable agent
  index.ts          # Creature HTTP server
  evolve.ts         # Patch decision logic
  apply.ts          # Apply patch + run checks

/src/shared/
  types.ts          # Event type definitions
  version.ts        # Simple version check for tests

/tests/
  checks.ts         # Validates version format

/.self/             # Runtime state (gitignored)
  events.jsonl      # Append-only event log
  last_good.txt     # SHA of last promoted commit
  boot-ok           # Health indicator file
  iteration_count.txt # Persisted iteration counter
```

## Event stream

All actions are recorded as structured events:

- `host.boot` - Supervisor started
- `host.spawn` - Creature process spawned
- `host.promote` - Commit promoted to last_good
- `host.rollback` - Reverted to previous commit
- `creature.boot` - Creature process started
- `creature.intent` - Describes planned action
- `creature.patch` - Files modified
- `creature.checks` - Test results
- `creature.request_restart` - Asking for restart into new commit

## Acceptance criteria met

1. ✅ Creature makes commits and requests restart
2. ✅ Host restarts into new commits
3. ✅ Host automatically rolls back on test failures
4. ✅ UI shows full story: intent → patch → checks → promote/rollback
5. ✅ No API keys in creature (ready for Janee integration)

## Next steps

- Add Janee integration for LLM-driven patches
- Enable auto-iteration mode
- Add more sophisticated patch strategies
- Support creature editing host code (multi-worktree)
