# Evaluating Sleep & Dreams Mechanism

Guide for checking whether the creature's sleep/dream/consolidation system is working as intended.

## Quick Health Check

Run these from the creature's directory (e.g. `~/.itsalive/creatures/alpha/`):

```bash
# Are dreams happening?
wc -l .self/dreams.jsonl

# Latest dream
tail -1 .self/dreams.jsonl | jq .

# Are observations accumulating?
wc -l .self/observations.md
tail -20 .self/observations.md

# Is the conversation log growing?
wc -l .self/conversation.jsonl

# Do priorities exist?
cat .self/priorities.md
```

## What to Look For

### 1. Consolidation is Firing

**Good signs:**
- `.self/dreams.jsonl` has entries with realistic `actions` counts (20-80)
- `.self/observations.md` has timestamped sections with `[!]` and `[.]` entries
- Dashboard shows purple "dream" events periodically

**Bad signs:**
- No dream entries after many hours of activity — consolidation may not be triggering
- Dreams with `actions: 0` or `actions: 1` — debounce may be broken
- Dreams firing every few minutes — debounce threshold too low

### 2. Observations are Useful

**Good signs:**
- `[!]` entries contain specific, actionable facts ("Logged into Twitter successfully", "Posted tweet #3")
- `[.]` entries are genuinely minor details
- Observations reference real actions the creature took

**Bad signs:**
- Generic observations ("Did some work", "Made progress")
- Observations that are just restating the purpose
- Identical observations repeated across dream cycles

### 3. Fatigue System is Working

**Good signs:**
- Creature never runs more than ~80 actions without a dream
- Dashboard shows occasional "forced consolidation" sleep events
- Creature's monologue references being tired / wrapping up near action 60+

**Bad signs:**
- Creature running 200+ actions with no consolidation — fatigue counter may not be incrementing
- Creature sleeping every 5 actions — threshold too low or counter resetting wrong

Check action counts in dreams:
```bash
jq '.actions' .self/dreams.jsonl
```

### 4. Wake-up Context is Rich

**Good signs:**
- After waking, creature references its dream reflection or priority
- Creature picks up where it left off rather than starting from scratch
- Creature mentions checking MESSAGES.md

**Bad signs:**
- Creature wakes up confused about what it was doing
- Creature re-does work it already completed (observations not being read)
- Creature never references its priorities

Check by searching the conversation log:
```bash
rg "woke up after" .self/conversation.jsonl | tail -5
```

### 5. Deep Sleep is Pruning

Deep sleep triggers every 10 dreams. Check:

```bash
# How many dreams so far?
wc -l .self/dreams.jsonl

# Any deep sleep entries?
jq 'select(.deep==true)' .self/dreams.jsonl

# Is diary being written?
cat self/diary.md

# Are priorities being rewritten?
cat .self/priorities.md
```

**Good signs:**
- `.self/observations.md` stays reasonable in size (not growing to megabytes)
- `self/diary.md` has periodic deep sleep summaries
- `.self/priorities.md` evolves over time

**Bad signs:**
- `.self/observations.md` growing unbounded — pruning not working
- Priorities never change — deep sleep may not be triggering

### 6. Conversation Log is Searchable

The creature should be able to search its own history:

```bash
# Can we find specific topics?
rg "twitter" .self/conversation.jsonl | wc -l

# Are entries well-formed JSON?
head -5 .self/conversation.jsonl | jq .

# How big is it? (expected: grows continuously)
du -h .self/conversation.jsonl
```

### 7. Dashboard Shows Dreams

On the web UI (`http://localhost:7770`):

- Dream events should appear with purple/indigo styling
- Deep sleep events should be visually distinct (brighter purple)
- Expanding a dream event shows reflection + priority text
- Dreams should appear between periods of tool_call activity

## Failure Modes to Watch For

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| No dreams at all | `onDream` callback not wired, or consolidation errors | Check creature container logs for errors |
| Dreams every minute | Debounce not working, `lastDreamTime` not updating | Check `MIN_DREAM_INTERVAL_MS` logic |
| Creature confused after wake | Wake injection not including observations | Check `wakeUp()` method output |
| Observations file huge | Deep sleep pruning failing | Check LLM call in `deepSleep()` |
| Conversation log empty | `appendToLog()` silently failing | Check file permissions in container |
| Priorities stale | Deep sleep not firing | Check `dreamCount` vs `DEEP_SLEEP_EVERY` |

## Tuning Knobs

All constants are in `template/src/mind.ts`:

| Constant | Default | What it controls |
|----------|---------|-----------------|
| `FATIGUE_WARNING` | 60 | Actions before "getting tired" message |
| `FATIGUE_LIMIT` | 80 | Actions before forced consolidation |
| `MIN_DREAM_INTERVAL_MS` | 10 min | Minimum time between dreams |
| `QUICK_NAP_THRESHOLD` | 30s | Sleeps shorter than this skip consolidation |
| `DEEP_SLEEP_EVERY` | 10 | Dreams between deep sleep cycles |
| `DEEP_SLEEP_PAUSE` | 300s | Forced pause duration during deep sleep |
| `KEEP_RECENT_MESSAGES` | 20 | Messages kept in context after trim |
| `MAX_CONTEXT_CHARS` | 100K | Emergency overflow threshold |
