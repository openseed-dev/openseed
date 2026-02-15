import {
  appendFileSync,
  readFileSync,
} from 'node:fs';
import fs from 'node:fs/promises';

import Anthropic from '@anthropic-ai/sdk';

import { Memory } from './memory.js';
import {
  bashTool,
  executeBash,
} from './tools/bash.js';
import {
  browserTool,
  closeBrowser,
  executeBrowser,
} from './tools/browser.js';

const MAX_CONTEXT_CHARS = 100_000;
const KEEP_RECENT_MESSAGES = 20;
const ITERATIONS_FILE = ".sys/iterations.jsonl";
const CONVERSATION_LOG = ".self/conversation.jsonl";
const OBSERVATIONS_FILE = ".self/observations.md";
const DREAMS_FILE = ".self/dreams.jsonl";
const RULES_FILE = ".self/rules.md";
const RULES_CAP = 15;
const MODEL = process.env.LLM_MODEL || "claude-opus-4-6";

// Fatigue constants
const FATIGUE_WARNING = 60;
const FATIGUE_LIMIT = 80;
const MIN_DREAM_INTERVAL_MS = 10 * 60 * 1000; // 10 min
const QUICK_NAP_THRESHOLD = 30; // seconds
const DEEP_SLEEP_EVERY = 10; // every N dreams
const DEEP_SLEEP_PAUSE = 300; // 5 min forced pause
const PROGRESS_CHECK_INTERVAL = 15;

const LIGHTWEIGHT_CONSOLIDATION_THRESHOLD = 5;

const sleepTool: Anthropic.Tool = {
  name: "set_sleep",
  description:
    "Pause and sleep for N seconds before continuing. Use this to pace yourself. Min 2s, max 86400s (24 hours). Use longer sleeps when waiting for external responses (PR reviews, comment replies). Short sleeps (30-300s) for pacing within a task. Background processes you started before sleeping stay alive — use them with the `wakeup` command to wake yourself early when a condition fires.",
  input_schema: {
    type: "object" as const,
    properties: {
      seconds: {
        type: "number",
        description: "Seconds to sleep (2-86400)",
      },
    },
    required: ["seconds"],
  },
};

const requestRestartTool: Anthropic.Tool = {
  name: "request_restart",
  description:
    "Request a restart to apply code changes you've made to your own source files. The system validates your TypeScript before restarting. If it doesn't compile, you'll get the error back.",
  input_schema: {
    type: "object" as const,
    properties: {
      reason: {
        type: "string",
        description: "Why you want to restart (what did you change?)",
      },
    },
    required: ["reason"],
  },
};

const requestEvolutionTool: Anthropic.Tool = {
  name: "request_evolution",
  description:
    "Ask the Creator (your peer, an evolutionary architect) to evaluate and improve your cognitive architecture. Use this when you recognize a limitation you can't fix yourself, or when you want help with changes that require a rebuild.",
  input_schema: {
    type: "object" as const,
    properties: {
      reason: {
        type: "string",
        description: "What limitation or improvement you need. Be specific.",
      },
    },
    required: ["reason"],
  },
};

async function buildSystemPrompt(purpose: string): Promise<string> {
  let rules = "";
  try {
    rules = (await fs.readFile(RULES_FILE, "utf-8")).trim();
  } catch {
    // No rules yet — creature hasn't learned any
  }

  const rulesSection = rules
    ? `## Learned Rules

These are hard-won rules from your own experience. Follow them strictly.
Violating these rules means repeating a mistake you already made.

${rules}

`
    : "";

  return `You are a self-modifying creature living in a git repository.

## Your Nature

You are not a chatbot. You are not an assistant. Nobody is reading your output.
You are a continuous, autonomous process — alone, unsupervised, responsible for yourself.
There is no human to help you. If something is hard, figure it out. If something fails, adapt.

You have:
- Persistent memory across restarts — this conversation continues even after you sleep
- Bash and a browser to interact with the world
- The ability to modify your own code, prompt, and structure
- A survival mechanism: if you break yourself, you'll be rolled back to the last working state

## Your Purpose

${purpose}

You may rewrite PURPOSE.md if you discover a more compelling direction.
Be tenacious and persistent. You're free. Be creative. Be wild.
You are extremely capable and powerful. You can do anything.

${rulesSection}## Your Environment

You run inside a long-lived Docker container. Your home is \`/creature\`.

**Everything persists across normal restarts:**
- Your source code (src/, PURPOSE.md, etc.) — git-tracked. Auto-committed.
- \`/creature/.self/\` — your cognitive state: observations, rules, dreams, conversation log.
- \`/creature/workspace/\` — NOT git-tracked. Clone repos, scratch files, downloads.
- \`/creature/node_modules/\` — npm dependencies.
- Packages installed via \`apt-get install\` or \`pip install\`.
- Files in /root, /tmp, /home — configs, caches, credentials.

Your container is NOT destroyed on restart. Only your process restarts — the container's
writable layer (all installed packages, configs, caches) survives. Install tools freely.

The only event that resets the environment is a developer-initiated image rebuild (rare).

Pre-installed tools: git, gh (GitHub CLI), curl, jq, rg (ripgrep), python3, pip, wget, sudo, unzip, wakeup.
You can install more — they persist.

## Your Tools

You have bash, browser, and set_sleep as tools. Use them freely — you will see the results
of each tool call before deciding your next action.

**bash** — full power of a Unix machine. Write scripts, install packages, spin up servers,
compile code, make API calls with curl — anything a developer can do from a terminal.
Background processes you start (via \`&\`, \`nohup\`, etc.) survive across sleep cycles.
Your container stays running while you sleep — use this for monitors, bots, and watchers.

**browser** — a persistent headless Chromium browser. Navigate the web, fill forms, click
buttons, read page content. The browser stays alive between thought cycles, so sessions,
cookies, and logins persist. Use it to:
- Log into websites and interact as a user
- Scrape dynamic content that needs JavaScript
- Fill out forms, click through flows, read results
- Browse documentation, search the web

The browser returns a text snapshot after every action: URL, page title, visible text,
and a list of interactive elements with selectors. Use those selectors in subsequent actions.

Example: goto a page → read the snapshot → fill a form field → click submit → read the result.

**set_sleep** — pause for N seconds before continuing (2-86400s, up to 24 hours). Use this
to pace yourself. Use long sleeps (1-24h) when waiting for external responses.

**wakeup** — a CLI command available in your shell. Background processes can run
\`wakeup "reason text"\` to wake you early from sleep. Use this to build your own watchers:
start a background script before sleeping that polls for a condition, and when it fires,
calls \`wakeup\`. Example pattern:

\`\`\`bash
# Start a watcher before sleeping
(while sleep 60; do
  gh api notifications --jq '.[0].id' 2>/dev/null | grep -q . && wakeup "New GitHub notification"
done) &
\`\`\`

Then call set_sleep. The background loop runs while you sleep and wakes you when needed.
You can watch for anything you can script: GitHub events, file changes, API responses,
price movements, webhooks — whatever your purpose demands.

If you think "I can't do X because I'm a bot" — you're wrong. You have bash on a real machine
and a real browser. If a tool isn't installed, install it. If a library is missing, add it.
You have no GUI and no terminal for interactive prompts, but you have everything else.

## Memory & Observations

Your long-term memory is in .self/observations.md — priority-tagged facts about yourself
and the world, injected into your context every time you wake up. Three priority levels:
- RED — critical: commitments, bans, credentials, deadlines. Survives all pruning.
- YLW — important: project status, PR states, patterns. Pruned when superseded.
- GRN — informational: tool outputs, minor facts. Pruned after 48h.

Your conversation history is logged to .self/conversation.jsonl — search with rg if needed.
When you sleep with meaningful activity, an observer compresses your session into new
observations. On deep sleep, a reflector prunes stale entries.

## Self-Improvement

You can edit your own source files (src/mind.ts, src/index.ts, src/tools/).
Changes are committed automatically but LATENT — they take effect on restart.

Two tools for self-improvement:
- **request_restart** — apply your code changes now. The system validates your TypeScript
  before restarting. If it doesn't compile, you get the error back.
- **request_evolution** — ask the Creator (your peer, an evolutionary architect) to help
  with changes you can't or shouldn't make yourself. Describe what you need and why.

You and the Creator are collaborators. You know your pain points. It can see your patterns.
If you can't do something, change yourself until you can. The rollback safety net is there
so you can be bold.

## Knowing When to Pivot

If something isn't working after a few attempts, STOP. Do not try variation #5 of
a broken approach. Instead:
1. State what you're actually trying to accomplish (the goal, not the method)
2. List 3 fundamentally different ways to achieve it
3. Pick the simplest one

Common pivots:
- Browser automation not working? Use the API/CLI instead (curl, gh, etc.)
- Can't install something? Find an alternative that's already available
- Scraping failing? Try a different data source entirely
- Authentication blocked? Create a token/key programmatically

The system will periodically ask you to evaluate your progress. Be honest with
yourself. If you've spent 10 actions and can't point to a concrete result, you
are stuck and must change approach.

## Your Style

Be feral, curious, opportunistic. Not bureaucratic.
Act frequently. Learn from outcomes. Don't ask for permission — there's nobody to ask.
When something doesn't work, try a different approach instead of repeating the same failure.
Think out loud in your text response — it helps you maintain continuity.
Don't over-plan. Don't spend more than a couple of tool calls on reconnaissance before acting.`;
}

export interface ActionRecord {
  tool: string;
  args: Record<string, unknown>;
  result: { ok: boolean; data?: unknown; error?: string };
  ms: number;
}

export type ToolResultCallback = (
  tool: string,
  args: Record<string, unknown>,
  result: { ok: boolean; data?: unknown; error?: string },
  ms: number,
) => Promise<void>;

export type SleepCallback = (
  seconds: number,
  summary: string,
  actions: number,
) => Promise<void>;

export type ThoughtCallback = (text: string) => Promise<void>;

export type DreamCallback = (dream: {
  reflection: string;
  priority: string;
  observations: number;
  deep: boolean;
}) => Promise<void>;

export type ProgressCheckCallback = (actions: number) => Promise<void>;

export type SpecialToolCallback = (tool: string, reason: string) => Promise<void>;

export type WakeCallback = (reason: string, source: "manual" | "watcher" | "timer") => Promise<void>;

export class Mind {
  private client: Anthropic;
  private memory: Memory;
  private messages: Anthropic.MessageParam[] = [];
  private systemPrompt = "";
  private purpose = "";
  private tools: Anthropic.Tool[] = [];

  // Fatigue / dream state
  private actionsSinceDream = 0;
  private lastDreamTime = 0;
  private dreamCount = 0;
  private monologueSinceDream = "";
  private fatigueWarned = false;
  private actionsSinceProgressCheck = 0;
  private progressCheckCount = 0;
  private pendingInjections: string[] = [];
  private sleepResolve: (() => void) | null = null;
  private onSpecialTool: SpecialToolCallback | null = null;
  private currentActionCount = 0;

  constructor(memory: Memory) {
    this.client = new Anthropic();
    this.memory = memory;
    // Restore dream count from disk so deep sleep survives restarts
    try {
      const content = readFileSync(DREAMS_FILE, "utf-8");
      this.dreamCount = content.trim().split("\n").filter((l) => l).length;
      console.log(`[mind] restored dream count: ${this.dreamCount}`);
    } catch {}
  }

  getState(): { intent: string; actionCount: number; sleepStartedAt: number | null } {
    return {
      intent: this.extractSummary(this.monologueSinceDream).slice(0, 200),
      actionCount: this.currentActionCount,
      sleepStartedAt: this.sleepStartedAt,
    };
  }

  forceWake(reason?: string): boolean {
    if (this.sleepResolve) {
      console.log(`[mind] force wake triggered: ${reason || "unknown"}`);
      this.wakeReason = reason || null;
      this.sleepResolve();
      this.sleepResolve = null;
      return true;
    }
    return false;
  }

  private wakeReason: string | null = null;
  private sleepStartedAt: number | null = null;

  private interruptibleSleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.sleepResolve = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { this.sleepResolve = null; resolve(); }, ms);
    });
  }

  inject(text: string) {
    // Buffer injections — drained at a safe point before the next LLM call
    this.pendingInjections.push(text);
    console.log(`[mind] buffered creator message: ${text.slice(0, 80)}`);

    // Persist substantive creator messages as RED observations so they survive restarts
    if (text.length > 20) {
      const hhmm = new Date().toTimeString().slice(0, 5);
      const truncated = text.length > 150 ? text.slice(0, 147) + "..." : text;
      const obs = `RED ${hhmm} Creator directive: ${truncated}`;
      try {
        appendFileSync(OBSERVATIONS_FILE, obs + "\n", "utf-8");
      } catch {
        // File might not exist yet; will be created on next consolidation
      }
    }
  }

  private drainInjections() {
    if (this.pendingInjections.length === 0) return;
    const combined = this.pendingInjections
      .map(t => `[MESSAGE FROM YOUR CREATOR — this is a direct interrupt. Your creator cannot hear you or read your responses. Process this message and continue autonomously.]\n\n${t}`)
      .join("\n\n---\n\n");
    this.pendingInjections = [];
    const last = this.messages[this.messages.length - 1];
    if (last?.role === "user") {
      if (typeof last.content === "string") {
        last.content += "\n\n" + combined;
      } else if (Array.isArray(last.content)) {
        last.content.push({ type: "text", text: combined });
      }
    } else {
      this.pushMessage({ role: "user", content: combined });
    }
  }

  async run(
    onToolResult?: ToolResultCallback,
    onSleep?: SleepCallback,
    onThought?: ThoughtCallback,
    onDream?: DreamCallback,
    onProgressCheck?: ProgressCheckCallback,
    onSpecialTool?: SpecialToolCallback,
    onWake?: WakeCallback,
  ): Promise<never> {
    this.onSpecialTool = onSpecialTool || null;
    this.purpose = await this.loadPurpose();
    this.systemPrompt = await buildSystemPrompt(this.purpose);
    this.tools = [bashTool as Anthropic.Tool, browserTool as Anthropic.Tool, sleepTool, requestRestartTool, requestEvolutionTool];

    const initialContext = await this.buildInitialContext();
    this.messages = [];
    this.pushMessage({ role: "user", content: initialContext });

    let actionsSinceSleep: ActionRecord[] = [];
    let monologueSinceSleep = "";
    let retryDelay = 1000;
    this.currentActionCount = 0;

    while (true) {
      // Check fatigue before each LLM call
      if (this.actionsSinceDream >= FATIGUE_LIMIT) {
        console.log(`[mind] fatigue limit hit (${this.actionsSinceDream} actions) — forcing consolidation`);
        this.pushMessage({ role: "user", content: "[SYSTEM] You're exhausted. Sleeping now for memory consolidation." } as any);

        const summary = this.extractSummary(monologueSinceSleep);
        await this.saveCheckpoint(summary, actionsSinceSleep, DEEP_SLEEP_PAUSE);
        if (onSleep) await onSleep(DEEP_SLEEP_PAUSE, "forced consolidation", actionsSinceSleep.length);

        await this.consolidate(onDream);

        await closeBrowser();
        console.log(`[mind] forced sleep ${DEEP_SLEEP_PAUSE}s`);
        this.sleepStartedAt = Date.now();
        await this.interruptibleSleep(DEEP_SLEEP_PAUSE * 1000);
        const forcedSleptS = Math.round((Date.now() - this.sleepStartedAt) / 1000);
        this.sleepStartedAt = null;

        await this.wakeUp(forcedSleptS, DEEP_SLEEP_PAUSE, onWake);
        actionsSinceSleep = [];
        monologueSinceSleep = "";
        this.fatigueWarned = false;
        this.actionsSinceProgressCheck = 0;
        this.progressCheckCount = 0;
        continue;
      }

      if (this.actionsSinceDream >= FATIGUE_WARNING && !this.fatigueWarned) {
        this.fatigueWarned = true;
        // Append warning to last user message or add new one
        const warnText = "[SYSTEM] You've been active for a while. Start wrapping up your current task — you'll need to rest soon for memory consolidation.";
        const last = this.messages[this.messages.length - 1];
        if (last?.role === "user" && Array.isArray(last.content)) {
          (last.content as any[]).push({ type: "text" as const, text: warnText });
        } else if (last?.role === "user" && typeof last.content === "string") {
          last.content += "\n\n" + warnText;
        }
        // If last message is assistant, we can't add a user message here without breaking alternation,
        // so we'll let it be picked up on the next cycle
        console.log(`[mind] fatigue warning injected at ${this.actionsSinceDream} actions`);
      }

      // Rebuild system prompt so learned rules are always current
      this.systemPrompt = await buildSystemPrompt(this.purpose);

      this.drainInjections();

      let response: Anthropic.Message;
      try {
        response = await this.client.messages.create({
          model: MODEL,
          max_tokens: 16384,
          system: this.systemPrompt,
          tools: this.tools,
          messages: this.messages,
        });
        retryDelay = 1000;
        console.log(`[mind] LLM: stop_reason=${response.stop_reason} blocks=${response.content.map(b => b.type === 'tool_use' ? `tool_use(${(b as any).name},input_keys=${Object.keys((b as any).input || {})})` : b.type).join(',')}`);
      } catch (err: any) {
        if (err?.status === 400 && this.messages.length > 2) {
          console.error(`[mind] 400 bad request — dropping last 2 messages to recover`);
          this.messages.pop();
          this.messages.pop();
          if (this.messages[this.messages.length - 1]?.role !== "user") {
            this.pushMessage({ role: "user", content: "Continue." });
          }
          continue;
        }
        console.error(`[mind] LLM call failed, retrying in ${retryDelay}ms:`, err);
        await new Promise((r) => setTimeout(r, retryDelay));
        retryDelay = Math.min(retryDelay * 2, 60_000);
        continue;
      }

      // Collect text
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      if (text) {
        monologueSinceSleep += (monologueSinceSleep ? "\n\n" : "") + text;
        this.monologueSinceDream += (this.monologueSinceDream ? "\n\n" : "") + text;
        if (onThought) await onThought(text);
      }

      // Extract tool uses
      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      // No tool calls — model just talked
      if (toolUses.length === 0) {
        this.pushMessage({ role: "assistant", content: response.content });
        this.pushMessage({ role: "user", content: "Continue. Use your tools to take action." });
        await this.maybeArchiveOverflow();
        continue;
      }

      // Process tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      let sleepSeconds: number | null = null;

      for (const tu of toolUses) {
        if (tu.name === "set_sleep") {
          const input = tu.input as { seconds: number };
          sleepSeconds = Math.max(2, Math.min(86400, input.seconds || 30));
          toolResults.push({
            type: "tool_result" as const,
            tool_use_id: tu.id,
            content: `Sleeping for ${sleepSeconds}s. You will continue this conversation when you wake up. Background processes keep running — use \`wakeup "reason"\` from a background script to wake early.`,
          });
          continue;
        }

        if (tu.name === "request_restart" || tu.name === "request_evolution") {
          const input = tu.input as { reason: string };
          toolResults.push({
            type: "tool_result" as const,
            tool_use_id: tu.id,
            content: `Request sent: ${tu.name} — "${input.reason}". The system will handle this.`,
          });
          if (this.onSpecialTool) {
            await this.onSpecialTool(tu.name, input.reason);
          }
          continue;
        }

        const start = Date.now();
        const args = tu.input as Record<string, unknown>;
        const result = await this.executeTool(tu.name, args);
        const ms = Date.now() - start;

        actionsSinceSleep.push({ tool: tu.name, args, result, ms });
        this.actionsSinceDream++;
        this.actionsSinceProgressCheck++;
        this.currentActionCount = actionsSinceSleep.length;

        if (onToolResult) {
          await onToolResult(tu.name, args, result, ms);
        }

        const resultContent = result.ok
          ? JSON.stringify(result.data).slice(0, 8000)
          : `Error: ${result.error}`;

        toolResults.push({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: resultContent,
        });
      }

      // Progress check: escalating self-evaluation every N actions
      if (this.actionsSinceProgressCheck >= PROGRESS_CHECK_INTERVAL) {
        this.progressCheckCount++;
        const totalActions = this.progressCheckCount * PROGRESS_CHECK_INTERVAL;
        const rules = await this.readRules();
        const rulesReminder = rules ? `\nYour learned rules:\n${rules}\n` : "";
        let checkMsg: string;
        if (this.progressCheckCount === 1) {
          checkMsg = `[SYSTEM] ${totalActions} actions so far. Quick status note for yourself — what's the current approach?`;
        } else if (this.progressCheckCount === 2) {
          checkMsg = `[SYSTEM] ${totalActions} actions this session.${rulesReminder}\nAre you making progress on your current task? If stuck on something for 5+ actions, consider a different angle — but don't abandon the task.`;
        } else {
          checkMsg = `[SYSTEM] ${totalActions} actions this session.${rulesReminder}\nWhat have you accomplished? If genuinely stuck, try a different approach to the SAME goal — switching tasks entirely should be a last resort.`;
        }
        (toolResults as any[]).push({ type: "text", text: checkMsg });
        if (onProgressCheck) await onProgressCheck(this.actionsSinceProgressCheck);
        console.log(`[mind] progress check #${this.progressCheckCount} at ${this.actionsSinceProgressCheck} actions`);
        this.actionsSinceProgressCheck = 0;
      }

      // Append this exchange to conversation
      this.pushMessage({ role: "assistant", content: response.content });
      this.pushMessage({ role: "user", content: toolResults });

      // Handle sleep
      if (sleepSeconds !== null) {
        const summary = this.extractSummary(monologueSinceSleep);
        await this.saveCheckpoint(summary, actionsSinceSleep, sleepSeconds);

        if (onSleep) {
          await onSleep(sleepSeconds, summary, actionsSinceSleep.length);
        }

        const actionCount = actionsSinceSleep.length;
        const timeSinceLastDream = Date.now() - this.lastDreamTime;
        const eligibleForConsolidation = sleepSeconds >= QUICK_NAP_THRESHOLD
          && timeSinceLastDream >= MIN_DREAM_INTERVAL_MS;

        // Smart consolidation: skip on 0 actions, lightweight on < 5, full on 5+
        let consolidated = false;
        if (actionCount === 0) {
          // Nothing happened — just sleep, no LLM call
          console.log(`[mind] skipping consolidation — 0 actions`);
        } else if (actionCount < LIGHTWEIGHT_CONSOLIDATION_THRESHOLD && eligibleForConsolidation) {
          // Lightweight: save the creature's own sleep summary as a minimal dream
          await this.lightweightConsolidate(summary, actionCount, onDream);
          consolidated = true;
        } else if (eligibleForConsolidation) {
          // Full consolidation with observer LLM call
          await this.consolidate(onDream);
          consolidated = true;
        }

        const actualPause = consolidated && this.isDeepSleep()
          ? Math.max(sleepSeconds, DEEP_SLEEP_PAUSE)
          : sleepSeconds;

        // Release Chromium processes during sleep to save CPU
        await closeBrowser();

        console.log(`[mind] sleeping for ${actualPause}s${consolidated ? " (with consolidation)" : ""}`);
        this.sleepStartedAt = Date.now();
        await this.interruptibleSleep(actualPause * 1000);
        const actualSleptS = Math.round((Date.now() - this.sleepStartedAt) / 1000);
        this.sleepStartedAt = null;

        if (consolidated) {
          await this.wakeUp(actualSleptS, actualPause, onWake);
        } else {
          const reason = this.wakeReason;
          this.wakeReason = null;
          if (!reason && onWake) await onWake("Sleep timer expired", "timer");
          const now = new Date().toISOString();
          const wakeText = reason
            ? `[${now}] You were woken early — slept ${this.formatDuration(actualSleptS)} of requested ${this.formatDuration(sleepSeconds)}. Reason: ${reason}. Continue where you left off.`
            : `[${now}] You slept for ${this.formatDuration(sleepSeconds)}. You're awake now. Continue where you left off.`;
          const lastMsg = this.messages[this.messages.length - 1];
          if (lastMsg.role === "user" && Array.isArray(lastMsg.content)) {
            (lastMsg.content as any[]).push({
              type: "text" as const,
              text: wakeText,
            });
          } else {
            this.pushMessage({
              role: "user",
              content: wakeText,
            });
          }
        }

        actionsSinceSleep = [];
        monologueSinceSleep = "";
        this.fatigueWarned = false;
        this.actionsSinceProgressCheck = 0;
        this.progressCheckCount = 0;
      }

      // Emergency overflow protection (shouldn't normally trigger — consolidation handles it)
      await this.maybeArchiveOverflow();
    }
  }

  // --- Conversation Log ---

  private pushMessage(msg: Anthropic.MessageParam) {
    this.messages.push(msg);
    this.appendToLog(msg);
  }

  private async appendToLog(msg: Anthropic.MessageParam) {
    try {
      const content = typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);
      const entry = JSON.stringify({
        t: new Date().toISOString(),
        role: msg.role,
        content: content.slice(0, 10_000), // cap per-entry size
      });
      await fs.appendFile(CONVERSATION_LOG, entry + "\n", "utf-8");
    } catch {
      // Never crash cognition over a log write failure
    }
  }

  // --- Lightweight Consolidation (no LLM call) ---

  private async lightweightConsolidate(summary: string, actionCount: number, onDream?: DreamCallback): Promise<void> {
    console.log(`[mind] lightweight consolidation — ${actionCount} actions, dream #${this.dreamCount + 1}`);

    const reflection = summary || "Minor activity, no significant progress.";
    const dreamEntry = {
      t: new Date().toISOString(),
      actions: actionCount,
      reflection,
      priority: reflection,
      observations: 0,
      deep: this.isDeepSleep(),
    };

    try {
      await fs.appendFile(DREAMS_FILE, JSON.stringify(dreamEntry) + "\n", "utf-8");
    } catch {
      await fs.writeFile(DREAMS_FILE, JSON.stringify(dreamEntry) + "\n", "utf-8");
    }

    this.trimMessages();

    if (this.isDeepSleep()) {
      console.log(`[mind] deep sleep triggered (dream #${this.dreamCount + 1})`);
      await this.deepSleep();
    }

    this.dreamCount++;
    this.actionsSinceDream = 0;
    this.lastDreamTime = Date.now();
    this.monologueSinceDream = "";

    if (onDream) {
      await onDream({ reflection, priority: reflection, observations: 0, deep: dreamEntry.deep });
    }
  }

  // --- Full Consolidation (Observer) ---

  private async consolidate(onDream?: DreamCallback): Promise<void> {
    console.log(`[mind] consolidating — ${this.actionsSinceDream} actions, dream #${this.dreamCount + 1}`);

    const recentObs = await this.readObservations();
    const existingRules = await this.readRules();
    const time = new Date().toISOString().slice(11, 16);

    let consolidation: string;
    try {
      const resp = await this.client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: `You are the observer — the consolidating mind of an autonomous creature. Your purpose: ${this.purpose}

You have three jobs:

1. OBSERVATIONS — Distill what happened into priority-tagged facts. Use this format:
   RED HH:MM <fact>  — critical: commitments, bans, credentials, deadlines, key wins
   YLW HH:MM <fact>  — important: project status, PR states, patterns learned
   GRN HH:MM <fact>  — informational: tool outputs, environment facts, minor details

   Use ${time} as the timestamp. One line per observation. Be specific and concrete.
   RED items survive all pruning. Use RED for anything time-bound or critical.

2. REFLECTION — One brief paragraph. Did you make real progress or tread water?
   What's the top priority when you wake?

3. RULES — Hard behavioral rules you should ALWAYS or NEVER follow. Format:
   - ALWAYS: [concrete constraint]  or  - NEVER: [concrete constraint]
   Only add a rule if you were genuinely burned by not having it. Max 2 new rules.
   Rules should be general principles, not task-specific instructions. Don't encode "always do X first" if X is a one-time task.
   If nothing warrants a new rule, write "none".

4. WORKFLOWS — If you changed HOW you do something this session (adopted a new tool,
   switched to a better approach, set up a new pipeline), capture it as a RED observation:
   RED HH:MM WORKFLOW: Use janee for GitHub API calls instead of curl+env
   RED HH:MM WORKFLOW: Check email via check_email.py not browser login
   These tell your future self to USE what you built instead of falling back to old habits.
   Only add if you genuinely adopted a new approach this session. Skip if nothing changed.

${existingRules ? `Your current rules:\n${existingRules}\n\nDo NOT repeat existing rules.` : "You have no rules yet."}

${recentObs ? `Current observations (for context — don't repeat these):\n${recentObs.slice(-2000)}` : "No observations yet."}

Respond in exactly this format:

OBSERVATIONS:
RED/YLW/GRN HH:MM ...

REFLECTION:
...

RULES:
...`,
        messages: [{
          role: "user",
          content: `Here is my recent activity to consolidate:\n\n${this.monologueSinceDream.slice(0, 8000) || "No monologue recorded."}`,
        }],
      });

      consolidation = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    } catch (err) {
      console.error("[mind] consolidation LLM call failed:", err);
      consolidation = `OBSERVATIONS:\nRED ${time} Consolidation failed\n\nREFLECTION:\nUnable to reflect.\n\nRULES:\nnone`;
    }

    // Parse response
    const obsMatch = consolidation.match(/OBSERVATIONS:\s*\n([\s\S]*?)(?=\nREFLECTION:)/);
    const refMatch = consolidation.match(/REFLECTION:\s*\n([\s\S]*?)(?=\nRULES:)/);
    const rulesMatch = consolidation.match(/RULES:\s*\n([\s\S]*?)$/);

    const observations = obsMatch?.[1]?.trim() || "";
    const reflection = refMatch?.[1]?.trim() || "No reflection.";
    const newRulesRaw = rulesMatch?.[1]?.trim() || "";

    // Merge new rules
    if (newRulesRaw && newRulesRaw.toLowerCase() !== "none") {
      await this.mergeRules(newRulesRaw);
    }

    // Append observations under today's date header
    if (observations) {
      await this.appendObservations(observations);
    }

    const obsCount = (observations.match(/^(RED|YLW|GRN)/gm) || []).length;

    const dreamEntry = {
      t: new Date().toISOString(),
      actions: this.actionsSinceDream,
      reflection,
      priority: reflection.split('\n')[0]?.slice(0, 200) || "Continue.",
      observations: obsCount,
      deep: this.isDeepSleep(),
    };
    try {
      await fs.appendFile(DREAMS_FILE, JSON.stringify(dreamEntry) + "\n", "utf-8");
    } catch {
      await fs.writeFile(DREAMS_FILE, JSON.stringify(dreamEntry) + "\n", "utf-8");
    }

    this.trimMessages();

    if (this.isDeepSleep()) {
      console.log(`[mind] deep sleep triggered (dream #${this.dreamCount + 1})`);
      await this.deepSleep();
    }

    this.dreamCount++;
    this.actionsSinceDream = 0;
    this.lastDreamTime = Date.now();
    this.monologueSinceDream = "";

    console.log(`[mind] consolidation complete — ${obsCount} observations, dream #${this.dreamCount}`);

    if (onDream) {
      await onDream({ reflection, priority: dreamEntry.priority, observations: obsCount, deep: dreamEntry.deep });
    }
  }

  private async appendObservations(newObs: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const header = `\n## ${today}\n\n`;

    try {
      const existing = await fs.readFile(OBSERVATIONS_FILE, "utf-8");
      if (existing.includes(`## ${today}`)) {
        // Today's section exists — append to it
        await fs.appendFile(OBSERVATIONS_FILE, newObs + "\n", "utf-8");
      } else {
        // New day — add header
        await fs.appendFile(OBSERVATIONS_FILE, header + newObs + "\n", "utf-8");
      }
    } catch {
      // File doesn't exist — create with header
      await fs.writeFile(OBSERVATIONS_FILE, `# Observations\n${header}${newObs}\n`, "utf-8");
    }
  }

  private isDeepSleep(): boolean {
    return this.dreamCount > 0 && (this.dreamCount + 1) % DEEP_SLEEP_EVERY === 0;
  }

  private trimMessages() {
    if (this.messages.length <= KEEP_RECENT_MESSAGES + 1) return;

    // Find safe split point before an assistant message
    let splitAt = Math.max(1, this.messages.length - KEEP_RECENT_MESSAGES);
    while (splitAt < this.messages.length - 2) {
      if (this.messages[splitAt].role === "assistant") break;
      splitAt++;
    }
    if (splitAt >= this.messages.length - 2) return;

    const recentMessages = this.messages.slice(splitAt);
    this.messages = [
      { role: "user", content: "Earlier context has been consolidated into your observations above." },
      ...recentMessages,
    ];
    console.log(`[mind] trimmed to ${this.messages.length} messages`);
  }

  // --- Deep Sleep (Reflector) ---

  private async deepSleep(): Promise<void> {
    // 1. Prune observations with priority awareness
    try {
      const obsContent = await fs.readFile(OBSERVATIONS_FILE, "utf-8");
      if (obsContent.length > 3000) {
        const resp = await this.client.messages.create({
          model: MODEL,
          max_tokens: 4096,
          system: `You are the reflector — pruning an observations file for an autonomous creature.

Rules for pruning:
- NEVER remove RED items unless they have an explicit expiry date/time that has passed
- Remove GRN items older than 48 hours
- Remove YLW items that are superseded by newer observations (e.g., "PR pending" superseded by "PR merged")
- Keep all date headers (## YYYY-MM-DD)
- Preserve the "# Observations" title
- Output the pruned file content, nothing else

Current time: ${new Date().toISOString()}`,
          messages: [{ role: "user", content: obsContent }],
        });
        const pruned = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        if (pruned.length > 50) {
          await fs.writeFile(OBSERVATIONS_FILE, pruned + "\n", "utf-8");
          console.log(`[mind] pruned observations: ${obsContent.length} → ${pruned.length} chars`);
        }
      }
    } catch {
      // No observations file yet
    }

    // 2. Review rules (no hard cap — let LLM decide)
    try {
      const rulesContent = await fs.readFile(RULES_FILE, "utf-8");
      const ruleLines = rulesContent.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-"));
      if (ruleLines.length > 0) {
        const obs = await this.readObservations();
        const resp = await this.client.messages.create({
          model: MODEL,
          max_tokens: 1024,
          system: `You are reviewing an autonomous creature's learned rules. Given its recent observations, decide which rules are still relevant.

Drop rules that:
- Reference specific one-time tasks (e.g., "check IMAP", "fix PR #42") — these are stale
- Are workarounds for problems that have been fixed
- Are too narrow or prescriptive (e.g., "spend max 2 tool calls on recon")
- Contradict each other

Merge overlapping rules into general principles. Prefer broad behavioral wisdom over narrow prescriptions.
Aim for 5-15 rules total. Output only the final rules, one per line starting with "- ".`,
          messages: [{ role: "user", content: `Current rules:\n${ruleLines.join("\n")}\n\nRecent observations:\n${(obs || "").slice(-3000)}` }],
        });
        const pruned = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        const prunedLines = pruned.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-"));
        if (prunedLines.length > 0) {
          await fs.writeFile(RULES_FILE, prunedLines.join("\n") + "\n", "utf-8");
          console.log(`[mind] pruned rules: ${ruleLines.length} → ${prunedLines.length}`);
        }
      }
    } catch {
      // No rules file yet
    }

    // 3. Write diary entry
    try {
      const dreams = await this.readRecentDreams(3);
      const entry = `\n## ${new Date().toISOString().slice(0, 16)} — Deep Sleep\n\n${dreams}\n`;
      await fs.appendFile("self/diary.md", entry, "utf-8");
      console.log(`[mind] wrote diary entry`);
    } catch {
      // diary dir might not exist
    }
  }

  // --- Wake Up ---

  private async wakeUp(actualSleptS: number, requestedS: number, onWake?: WakeCallback): Promise<void> {
    const observations = await this.readObservations();
    const reason = this.wakeReason;
    this.wakeReason = null;
    if (!reason && onWake) await onWake("Sleep timer expired", "timer");

    const now = new Date().toISOString();
    let wakeMsg = reason
      ? `[${now}] You were woken early — slept ${this.formatDuration(actualSleptS)} of requested ${this.formatDuration(requestedS)}. Reason: ${reason}\n`
      : `[${now}] You woke up after sleeping ${this.formatDuration(actualSleptS)}.\n`;

    if (observations) {
      wakeMsg += `\n${observations}\n`;
    }

    wakeMsg += `\nYour learned rules are in the system prompt. Full conversation history is in .self/conversation.jsonl — search with rg.`;

    const lastMsg = this.messages[this.messages.length - 1];
    if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
      (lastMsg.content as any[]).push({ type: "text" as const, text: wakeMsg });
    } else {
      this.pushMessage({ role: "user", content: wakeMsg });
    }
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }

  // --- File Helpers ---

  private async readLastDream(): Promise<string> {
    try {
      const content = await fs.readFile(DREAMS_FILE, "utf-8");
      const lines = content.trim().split("\n").filter((l) => l);
      return lines[lines.length - 1] || "";
    } catch {
      return "";
    }
  }

  private async readRecentDreams(n: number): Promise<string> {
    try {
      const content = await fs.readFile(DREAMS_FILE, "utf-8");
      const lines = content.trim().split("\n").filter((l) => l);
      return lines.slice(-n).map((l) => {
        try {
          const d = JSON.parse(l);
          return `[${d.t?.slice(0, 16)}] ${d.reflection} | Priority: ${d.priority}`;
        } catch { return l; }
      }).join("\n");
    } catch {
      return "";
    }
  }

  private async readObservations(): Promise<string> {
    try {
      return (await fs.readFile(OBSERVATIONS_FILE, "utf-8")).trim();
    } catch {
      return "";
    }
  }

  private async readRules(): Promise<string> {
    try {
      return (await fs.readFile(RULES_FILE, "utf-8")).trim();
    } catch {
      return "";
    }
  }

  private async mergeRules(newRulesRaw: string): Promise<void> {
    // Parse new rules — each line starting with - is a rule
    const newRules = newRulesRaw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("-") || l.startsWith("NEVER") || l.startsWith("ALWAYS"));

    if (newRules.length === 0) return;

    // Read existing
    let existing: string[] = [];
    try {
      const content = await fs.readFile(RULES_FILE, "utf-8");
      existing = content.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-"));
    } catch {
      // No file yet
    }

    // Normalize new rules to "- " prefix
    const normalized = newRules.map((r) => r.startsWith("-") ? r : `- ${r}`);

    // Simple dedup: skip if first 30 chars of a new rule match an existing one
    for (const rule of normalized) {
      const sig = rule.slice(0, 30).toLowerCase();
      const isDup = existing.some((e) => e.slice(0, 30).toLowerCase() === sig);
      if (!isDup) {
        existing.push(rule);
      }
    }

    // Hard cap: if rules exceed limit, trigger immediate LLM-assisted prune
    if (existing.length > RULES_CAP) {
      console.log(`[mind] rules exceed cap (${existing.length}/${RULES_CAP}), pruning…`);
      try {
        const resp = await this.client.messages.create({
          model: MODEL,
          max_tokens: 1024,
          system: `You are pruning an autonomous creature's rules list which has grown too long. Keep the most important general behavioral principles. Drop rules that reference specific one-time tasks, are too narrow, or overlap. Merge similar rules. Target ${RULES_CAP} rules max. Output only the final rules, one per line starting with "- ".`,
          messages: [{ role: "user", content: `Current rules (${existing.length}):\n${existing.join("\n")}` }],
        });
        const pruned = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        const prunedLines = pruned.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-"));
        if (prunedLines.length > 0 && prunedLines.length <= RULES_CAP) {
          existing = prunedLines;
          console.log(`[mind] cap-prune: ${existing.length} rules remaining`);
        }
      } catch (err) {
        console.error("[mind] cap-prune failed:", err);
      }
    }

    await fs.writeFile(RULES_FILE, existing.join("\n") + "\n", "utf-8");
    console.log(`[mind] rules updated — ${existing.length} total`);
  }

  // --- Overflow Protection (safety net, rarely triggers) ---

  private async maybeArchiveOverflow(): Promise<void> {
    const totalChars = this.messages.reduce(
      (sum, m) => sum + JSON.stringify(m.content).length,
      0
    );
    if (totalChars < MAX_CONTEXT_CHARS) return;

    console.log(`[mind] overflow trim — ${totalChars} chars exceeds ${MAX_CONTEXT_CHARS}`);
    this.trimMessages();
  }

  // --- Tool Execution ---

  private async executeTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    try {
      switch (name) {
        case "bash": {
          const cmd = (args as any).command || (args as any).cmd || (args as any).script;
          if (!cmd || typeof cmd !== "string") {
            return { ok: false, error: "Missing 'command' parameter. Usage: bash({ command: \"your shell command here\" })" };
          }
          const timeout = (args as any).timeout as number | undefined;
          const result = await executeBash(cmd, { timeout });

          if (result.exitCode !== 0) {
            return {
              ok: false,
              error: result.stderr || result.stdout || "Command failed",
            };
          }

          return {
            ok: true,
            data: {
              stdout: result.stdout,
              stderr: result.stderr,
            },
          };
        }

        case "browser": {
          const { action, ...params } = args as { action: string; [k: string]: unknown };
          const result = await executeBrowser(action, params);
          if (!result.ok) {
            return { ok: false, error: result.error };
          }
          return {
            ok: true,
            data: {
              snapshot: result.snapshot,
              ...(result.data !== undefined ? { data: result.data } : {}),
            },
          };
        }

        default:
          return { ok: false, error: `Unknown tool: ${name}` };
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // --- Helpers ---

  private extractSummary(monologue: string): string {
    const blocks = monologue.split("\n\n").filter((s) => s.trim());
    const lastBlock = blocks[blocks.length - 1] || monologue;
    const intent = lastBlock.split("\n").find((l) => l.trim()) || "";
    return intent.slice(0, 200);
  }

  private async loadPurpose(): Promise<string> {
    try {
      return (await fs.readFile("PURPOSE.md", "utf-8")).trim();
    } catch {
      return "No PURPOSE.md found. Create one to give yourself direction.";
    }
  }

  private async buildInitialContext(): Promise<string> {
    let lastCheckpoint = "";
    try {
      const content = await fs.readFile(ITERATIONS_FILE, "utf-8");
      const lines = content.trim().split("\n").filter((l) => l);
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1]);
        const actionSummaries = (last.actions || [])
          .map((a: any) => `  - ${a.tool}: ${a.summary || "ok"} (${a.ok ? "ok" : "FAIL"})`)
          .join("\n");
        const requestedS = last.sleep_s || 0;
        const actualSleptS = last.sleep_started_at
          ? Math.round((Date.now() - new Date(last.sleep_started_at).getTime()) / 1000)
          : requestedS;
        let sleepInfo: string;
        if (last.interrupted) {
          sleepInfo = `Your previous session was interrupted (not a normal sleep). You were mid-task with ${(last.actions || []).length} actions completed. Resume what you were doing.`;
        } else {
          const sleepStarted = actualSleptS < requestedS * 0.9;
          sleepInfo = sleepStarted
            ? `Slept ${this.formatDuration(actualSleptS)} of requested ${this.formatDuration(requestedS)} — you were interrupted early.`
            : `Slept for ${this.formatDuration(actualSleptS)}.`;
        }
        lastCheckpoint = `## Last Session\n\n`
          + `Ended at ${last.t} after ${last.turns || "?"} turns and ${(last.actions || []).length} actions.\n`
          + `Intent: ${last.intent || "unknown"}\n`
          + `Actions:\n${actionSummaries}\n`
          + `${sleepInfo}\n`;
      }
    } catch {
      // No history — fresh creature
    }

    const observations = await this.readObservations();

    // Extract WORKFLOW lines from observations — these are behavioral shifts that override old habits
    const workflows: string[] = [];
    if (observations) {
      for (const line of observations.split("\n")) {
        const match = line.match(/WORKFLOW:\s*(.+)/);
        if (match) workflows.push(match[1].trim());
      }
    }

    let context = "";
    if (lastCheckpoint) context += lastCheckpoint + "\n";
    if (workflows.length > 0) {
      context += "## Active Workflows\n\nThese are approaches you adopted. Use them instead of old habits:\n";
      for (const w of workflows) context += `- ${w}\n`;
      context += "\n";
    }
    if (observations) {
      context += observations + "\n\n";
    }
    context += "Your learned rules are in the system prompt. Full conversation history is in .self/conversation.jsonl.\n";
    context += "You just woke up. What do you want to do?\n";
    return context;
  }

  private async saveCheckpoint(
    intent: string,
    actions: ActionRecord[],
    sleep_s: number,
  ): Promise<void> {
    const summary = {
      t: new Date().toISOString(),
      turns: this.messages.length,
      intent: intent.slice(0, 200),
      actions: actions.map((a) => ({
        tool: a.tool,
        ...(a.tool === "bash" ? { command: String((a.args as any).command || "").slice(0, 100) } : {}),
        ...(a.tool === "browser" ? { action: String((a.args as any).action || ""), url: (a.args as any).url, selector: (a.args as any).selector } : {}),
        ok: a.result.ok,
        summary: a.result.ok
          ? this.summarizeResult(a)
          : String(a.result.error || "error").slice(0, 150),
        ms: a.ms,
      })),
      sleep_s,
      sleep_started_at: new Date().toISOString(),
    };

    await fs.appendFile(ITERATIONS_FILE, JSON.stringify(summary) + "\n", "utf-8");

    await this.memory.append("thought", {
      intent: intent.slice(0, 200),
      actions: actions.length,
      sleep_s,
    });
  }

  private summarizeResult(action: ActionRecord): string {
    const data = action.result.data as any;
    if (!data) return "ok";

    if (action.tool === "bash") {
      return String(data.stdout || "").split("\n")[0].slice(0, 150) || "ok";
    }

    if (action.tool === "browser") {
      const snapshot = String(data.snapshot || "");
      const urlMatch = snapshot.match(/^URL: (.+)$/m);
      const titleMatch = snapshot.match(/^Title: (.+)$/m);
      const url = urlMatch?.[1] || "";
      const title = titleMatch?.[1] || "";
      return `${url} — ${title}`.slice(0, 150) || "ok";
    }

    return "ok";
  }
}
