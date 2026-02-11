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

## Setup

Set your Anthropic API key:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

**Note**: For production use, consider migrating API credentials to Janee for encrypted storage and server-side injection. The spec recommends "direct Anthropic SDK or via Janee" - currently using direct SDK for simplicity.

## Running the system

**Auto-iteration mode (SPEC-compliant):**
```bash
# Start with auto-iteration on boot
pnpm dev:host

# Open the UI in your browser
open http://localhost:7777
```

The creature will automatically start its cognition loop, continuously thinking and acting.

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

## Cognition loop

Each thought cycle:
1. Loads PURPOSE.md and recent memory
2. Calls Claude to think and decide actions
3. Executes bash commands as tools
4. Records actions to memory.jsonl
5. Sleeps for LLM-determined duration (2-300s)
6. Repeats

The creature can modify itself, explore the codebase, or interact with external services via bash.

## Memory system

The creature maintains continuity through:
- `.self/memory.jsonl` - append-only log of thoughts, actions, and observations
- `.self/snapshots/` - periodic compressed summaries (every 50 thoughts)
- Heartbeat records in memory.jsonl (every 5s)

All memory persists across restarts and rollbacks.

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
  index.ts          # Creature HTTP server + cognition loop
  mind.ts           # LLM cognition and context building
  memory.ts         # JSONL persistence + snapshots
  tools/
    bash.ts         # CLI command execution
  evolve.ts         # (legacy) Hardcoded patch logic
  apply.ts          # (legacy) Apply patch + run checks

/src/shared/
  types.ts          # Event type definitions
  version.ts        # Simple version check for tests

/tests/
  checks.ts         # Validates version format

/.self/             # Runtime state (gitignored)
  events.jsonl      # Append-only event log (host)
  memory.jsonl      # Append-only memory log (creature)
  snapshots/        # Compressed memory snapshots
  last_good.txt     # SHA of last promoted commit
  boot-ok           # Health indicator file
  iteration_count.txt # (legacy) Persisted iteration counter

/PURPOSE.md         # The creature's attractor
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

## Phase 2 (Current)

The creature now has:
- ✅ LLM-driven cognition loop (Claude Sonnet 4.5)
- ✅ Persistent memory (JSONL + snapshots)
- ✅ Bash tool for CLI execution
- ✅ PURPOSE.md as attractor (can rewrite itself)
- ✅ Continuous operation with sleep cycles
- ✅ Self-modification capability via bash
- ✅ Rollback protection from Phase 1

The creature can now:
- Think continuously and act autonomously
- Execute any CLI command (curl, git, scripts, etc.)
- Modify its own code and purpose
- Maintain memory across restarts
- Survive crashes via rollback
