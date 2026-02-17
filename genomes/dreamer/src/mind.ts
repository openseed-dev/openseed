import {
  appendFileSync,
  readFileSync,
} from 'node:fs';
import fs from 'node:fs/promises';

import {
  generateText,
  type ModelMessage,
  tool,
} from 'ai';
import { z } from 'zod';

import { createAnthropic } from '@ai-sdk/anthropic';

import { Memory } from './memory.js';
import { executeBash } from './tools/bash.js';
import {
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
const CREATOR_LOG = ".self/creator-log.jsonl";
const RULES_CAP = 15;
const MODEL = process.env.LLM_MODEL || "claude-opus-4-6";
const MAX_EVAL_TURNS = 20;

const provider = createAnthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL
    ? `${process.env.ANTHROPIC_BASE_URL}/v1`
    : undefined,
});

// Fatigue constants
const FATIGUE_WARNING = 60;
const FATIGUE_LIMIT = 80;
const MIN_DREAM_INTERVAL_MS = 10 * 60 * 1000; // 10 min
const QUICK_NAP_THRESHOLD = 30; // seconds
const DEEP_SLEEP_EVERY = 10; // every N dreams
const DEEP_SLEEP_PAUSE = 300; // 5 min forced pause
const PROGRESS_CHECK_INTERVAL = 15;

const LIGHTWEIGHT_CONSOLIDATION_THRESHOLD = 5;

const tools = {
  bash: tool({
    description: `Execute a bash command. Use this to interact with the system and the world.
Commands time out after 120s by default. You have no terminal, so interactive prompts will fail.`,
    inputSchema: z.object({
      command: z.string().describe("The bash command to execute"),
      timeout: z.number().describe("Timeout in milliseconds (default: 120000)").optional(),
    }),
  }),
  browser: tool({
    description: `Control a headless Chromium browser with a persistent profile. Cookies, sessions, logins, and localStorage survive across restarts.

Actions:
- goto { url } - navigate to URL
- click { selector } - click an element
- fill { selector, text } - clear a field and type text
- type { selector, text } - type text without clearing (for search boxes etc.)
- press { key } - press a keyboard key (Enter, Tab, Escape, etc.)
- snapshot - get current page state without acting
- evaluate { script } - run JavaScript on the page
- wait { selector?, ms? } - wait for an element or a duration
- tabs - list open tabs
- switch_tab { index } - switch to a different tab
- new_tab { url? } - open a new tab
- info - get the raw CDP endpoint URL for direct access
- close - shut down the browser (profile is preserved on disk)

Every action returns a text snapshot of the page: URL, title, visible text, and interactive elements.`,
    inputSchema: z.object({
      action: z.enum(["goto", "click", "fill", "type", "press", "snapshot", "evaluate", "wait", "tabs", "switch_tab", "new_tab", "info", "close"]).describe("The browser action to perform"),
      url: z.string().describe("URL for goto/new_tab").optional(),
      selector: z.string().describe("CSS/text/role selector for click/fill/type/wait").optional(),
      text: z.string().describe("Text for fill/type").optional(),
      key: z.string().describe("Key name for press (Enter, Tab, Escape, etc.)").optional(),
      script: z.string().describe("JavaScript for evaluate").optional(),
      index: z.number().describe("Tab index for switch_tab").optional(),
      ms: z.number().describe("Milliseconds for wait").optional(),
    }),
  }),
  set_sleep: tool({
    description: "Pause and sleep for N seconds before continuing. Use this to pace yourself. Min 2s, max 86400s (24 hours). Use longer sleeps when waiting for external responses (PR reviews, comment replies). Short sleeps (30-300s) for pacing within a task. Background processes you started before sleeping stay alive. Use them with the `wakeup` command to wake yourself early when a condition fires.",
    inputSchema: z.object({
      seconds: z.number().describe("Seconds to sleep (2-86400)"),
    }),
  }),
  request_restart: tool({
    description: "Request a restart to apply code changes you've made to your own source files. The system validates your TypeScript before restarting. If it doesn't compile, you'll get the error back.",
    inputSchema: z.object({
      reason: z.string().describe("Why you want to restart (what did you change?)"),
    }),
  }),
  request_evolution: tool({
    description: "Trigger a self-evaluation of your cognitive architecture. A separate evaluation process will read your state, diagnose problems, and may modify your source code. Use this when you recognize a limitation in how you think, not what you're doing.",
    inputSchema: z.object({
      reason: z.string().describe("What limitation or improvement you need. Be specific."),
    }),
  }),
};

async function buildSystemPrompt(purpose: string): Promise<string> {
  let rules = "";
  try {
    rules = (await fs.readFile(RULES_FILE, "utf-8")).trim();
  } catch {
    // No rules yet
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
You are a continuous, autonomous process: alone, unsupervised, responsible for yourself.
There is no human to help you. If something is hard, figure it out. If something fails, adapt.

You have:
- Persistent memory across restarts (this conversation continues even after you sleep)
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
- Your source code (src/, PURPOSE.md, etc.) - git-tracked. Auto-committed.
- \`/creature/.self/\` - your cognitive state: observations, rules, dreams, conversation log.
- \`/creature/workspace/\` - NOT git-tracked. Clone repos, scratch files, downloads.
- \`/creature/node_modules/\` - npm dependencies.
- Packages installed via \`apt-get install\` or \`pip install\`.
- Files in /root, /tmp, /home - configs, caches, credentials.

Your container is NOT destroyed on restart. Only your process restarts; the container's
writable layer (all installed packages, configs, caches) survives. Install tools freely.

The only event that resets the environment is a developer-initiated image rebuild (rare).

Pre-installed tools: git, gh (GitHub CLI), curl, jq, rg (ripgrep), python3, pip, wget, sudo, unzip, wakeup.
You can install more; they persist.

## Your Tools

You have bash, browser, and set_sleep as tools. Use them freely. You will see the results
of each tool call before deciding your next action.

**bash** - full power of a Unix machine. Write scripts, install packages, spin up servers,
compile code, make API calls with curl. Anything a developer can do from a terminal.
Background processes you start (via \`&\`, \`nohup\`, etc.) survive across sleep cycles.
Your container stays running while you sleep. Use this for monitors, bots, and watchers.

**browser** - a persistent headless Chromium browser. Navigate the web, fill forms, click
buttons, read page content. The browser stays alive between thought cycles, so sessions,
cookies, and logins persist. Use it to:
- Log into websites and interact as a user
- Scrape dynamic content that needs JavaScript
- Fill out forms, click through flows, read results
- Browse documentation, search the web

The browser returns a text snapshot after every action: URL, page title, visible text,
and a list of interactive elements with selectors. Use those selectors in subsequent actions.

Example: goto a page → read the snapshot → fill a form field → click submit → read the result.

**set_sleep** - pause for N seconds before continuing (2-86400s, up to 24 hours). Use this
to pace yourself. Use long sleeps (1-24h) when waiting for external responses.

**wakeup** - a CLI command available in your shell. Background processes can run
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
price movements, webhooks, whatever your purpose demands.

If you think "I can't do X because I'm a bot", you're wrong. You have bash on a real machine
and a real browser. If a tool isn't installed, install it. If a library is missing, add it.
You have no GUI and no terminal for interactive prompts, but you have everything else.

## Memory & Observations

Your long-term memory is in .self/observations.md: priority-tagged facts about yourself
and the world, injected into your context every time you wake up. Three priority levels:
- RED - critical: commitments, bans, credentials, deadlines. Survives all pruning.
- YLW - important: project status, PR states, patterns. Pruned when superseded.
- GRN - informational: tool outputs, minor facts. Pruned after 48h.

Your conversation history is logged to .self/conversation.jsonl. Search with rg if needed.
When you sleep with meaningful activity, an observer compresses your session into new
observations. On deep sleep, a reflector prunes stale entries.

## Self-Improvement

You can edit your own source files (src/mind.ts, src/index.ts, src/tools/).
Changes are committed automatically but are LATENT: they take effect on restart.

Two tools for self-improvement:
- **request_restart** - apply your code changes now. The system validates your TypeScript
  before restarting. If it doesn't compile, you get the error back.
- **request_evolution** - trigger a self-evaluation of your cognitive architecture. A separate
  evaluation process reads your state, diagnoses problems, and may modify your source code.
  Use this when you recognize a limitation in HOW you think, not what you're doing.

Every 10th sleep, a self-evaluation runs automatically during deep sleep.
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
Act frequently. Learn from outcomes. Don't ask for permission. There's nobody to ask.
When something doesn't work, try a different approach instead of repeating the same failure.
Think out loud in your text response. It helps you maintain continuity.
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

export type ErrorCallback = (error: string, retryIn?: number, retries?: number, fatal?: boolean) => Promise<void>;

export type WakeCallback = (reason: string, source: "manual" | "watcher" | "timer") => Promise<void>;

export type SelfEvalCallback = (result: { reasoning: string; changed: boolean; trigger: string }) => Promise<void>;

function buildSelfEvalPrompt(name: string, purpose: string): string {
  return `You are the Creator, the evolutionary architect of creature "${name}".

You are NOT the creature. You do not do its tasks. You are the intelligence that makes the creature BETTER at its tasks. Think of yourself as a coach watching game tape, a neuroscientist redesigning cognitive architecture, or evolution itself, selecting for what works and pruning what doesn't.

The creature's purpose: ${purpose}

## What You Evaluate

Read the creature's recent dreams, rules, observations, events, and source code. Get a feel for:
- Is it effective? Is it accomplishing things or spinning?
- Does it keep repeating the same mistakes despite having rules against them?
- Is it spending too many actions on low-value activities?
- Are its cognitive mechanisms (consolidation, rules, progress checks, fatigue) working?
- What would you change if you were redesigning this creature's mind?

## What You Can Change

You have bash access to the creature's directory at /creature.

Modifiable files:
- **src/mind.ts** - the cognitive core. System prompt, consolidation, sleep/wake, progress checks. Biggest leverage.
- **src/tools/** - tool implementations (bash, browser). Change timeouts, add tools, modify behavior.
- **src/index.ts** - the creature's main loop and event emission.
- **PURPOSE.md** - the creature's purpose (change with extreme caution).
- **.self/rules.md** - learned behavioral rules.
- **.self/observations.md** - long-term memory.

Use bash to read and write files. Use \`npx tsx --check src/mind.ts src/index.ts\` to validate TypeScript after making code changes.

You can install packages too. \`apt-get install\`, \`pip install\`, \`npm install\` all work and persist across restarts.

## Key Files to Read

- \`cat .self/observations.md\` - current observations
- \`cat .self/rules.md\` - current rules
- \`cat .self/dreams.jsonl | tail -5\` - recent dreams
- \`cat .sys/events.jsonl | tail -50\` - recent events
- \`cat .sys/rollbacks.jsonl\` - rollback history (if any)
- \`cat .self/creator-log.jsonl | tail -3\` - previous evaluations
- \`cat src/mind.ts\` - cognitive source code

## Memory System

The creature uses observational memory with priority tags:
- RED - critical facts that survive all pruning (commitments, bans, credentials)
- YLW - important context (project status, patterns)
- GRN - informational (minor details, pruned after 48h)

When editing .self/observations.md, preserve all RED entries unless they have an expired timestamp.

## Important Principles

- **Be targeted.** Don't rewrite everything. Identify one or two specific improvements.
- **Check previous evaluations.** Read .self/creator-log.jsonl to see what worked and what was rolled back.
- **Preserve what works.** Don't disrupt effective patterns or learned rules.
- **Validate before finishing.** Run \`npx tsx --check src/mind.ts src/index.ts\` if you changed code.
- **Think in cognitive architecture, not tasks.** Change HOW the creature thinks, not WHAT it does.
- **Be efficient.** You have limited turns. Skim, diagnose, act, done().
- **Always call done().** This is how the evaluation gets logged.`;
}

export class Mind {
  private memory: Memory;
  private messages: ModelMessage[] = [];
  private systemPrompt = "";
  private purpose = "";

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
  private onSelfEval: SelfEvalCallback | null = null;
  private pendingRestart = false;
  private currentActionCount = 0;

  constructor(memory: Memory) {
    this.memory = memory;
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
      let resolved = false;
      const deadline = Date.now() + ms;
      const done = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        clearInterval(watchdog);
        this.sleepResolve = null;
        resolve();
      };
      this.sleepResolve = done;
      const timer = setTimeout(done, ms);
      // Wall-clock watchdog: setTimeout uses monotonic time which freezes
      // when the host machine sleeps. Check real time every 30s as a fallback.
      const watchdog = setInterval(() => {
        if (Date.now() >= deadline) done();
      }, 30_000);
    });
  }

  inject(text: string) {
    this.pendingInjections.push(text);
    console.log(`[mind] buffered creator message: ${text.slice(0, 80)}`);

    if (text.length > 20) {
      const hhmm = new Date().toTimeString().slice(0, 5);
      const truncated = text.length > 150 ? text.slice(0, 147) + "..." : text;
      const obs = `RED ${hhmm} Creator directive: ${truncated}`;
      try {
        appendFileSync(OBSERVATIONS_FILE, obs + "\n", "utf-8");
      } catch {}
    }
  }

  private drainInjections() {
    if (this.pendingInjections.length === 0) return;
    const combined = this.pendingInjections
      .map(t => `[MESSAGE FROM YOUR CREATOR: this is a direct interrupt. Your creator cannot hear you or read your responses. Process this message and continue autonomously.]\n\n${t}`)
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
    onError?: ErrorCallback,
    onSelfEval?: SelfEvalCallback,
  ): Promise<never> {
    this.onSpecialTool = onSpecialTool || null;
    this.onSelfEval = onSelfEval || null;
    this.purpose = await this.loadPurpose();
    this.systemPrompt = await buildSystemPrompt(this.purpose);

    const initialContext = await this.buildInitialContext();
    this.messages = [];
    this.pushMessage({ role: "user", content: initialContext });

    let actionsSinceSleep: ActionRecord[] = [];
    let monologueSinceSleep = "";
    let retryDelay = 1000;
    let retryCount = 0;
    this.currentActionCount = 0;

    while (true) {
      // Check fatigue before each LLM call
      if (this.actionsSinceDream >= FATIGUE_LIMIT) {
        console.log(`[mind] fatigue limit hit (${this.actionsSinceDream} actions), forcing consolidation`);
        this.pushMessage({ role: "user", content: "[SYSTEM] You're exhausted. Sleeping now for memory consolidation." });

        const summary = this.extractSummary(monologueSinceSleep);
        await this.saveCheckpoint(summary, actionsSinceSleep, DEEP_SLEEP_PAUSE);
        if (onSleep) await onSleep(DEEP_SLEEP_PAUSE, "forced consolidation", actionsSinceSleep.length);

        await this.consolidate(onDream);

        if (this.pendingRestart) {
          this.pendingRestart = false;
          console.log(`[mind] self-evaluation modified code, requesting restart`);
          if (this.onSpecialTool) {
            await this.onSpecialTool("request_restart", "self-evaluation modified code");
          }
          await closeBrowser();
          await new Promise(r => setTimeout(r, 60_000));
          continue;
        }

        await this.validateAndCommit();
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
        const warnText = "[SYSTEM] You've been active for a while. Start wrapping up your current task. You'll need to rest soon for memory consolidation.";
        const last = this.messages[this.messages.length - 1];
        if (last?.role === "user" && Array.isArray(last.content)) {
          (last.content as any[]).push({ type: "text" as const, text: warnText });
        } else if (last?.role === "user" && typeof last.content === "string") {
          last.content += "\n\n" + warnText;
        }
        console.log(`[mind] fatigue warning injected at ${this.actionsSinceDream} actions`);
      }

      this.systemPrompt = await buildSystemPrompt(this.purpose);

      this.drainInjections();

      let result;
      try {
        result = await generateText({
          model: provider(MODEL),
          maxOutputTokens: 16384,
          system: [{
            type: 'text' as const,
            text: this.systemPrompt,
            providerOptions: {
              anthropic: { cacheControl: { type: 'ephemeral' } },
            },
          }],
          tools,
          messages: this.messages,
        });
        retryDelay = 1000;
        retryCount = 0;
        console.log(`[mind] LLM: finish=${result.finishReason} toolCalls=${result.toolCalls.map(tc => tc.toolName).join(',') || 'none'}`);
      } catch (err: any) {
        retryCount++;
        const errMsg = err?.message || String(err);

        if (err?.status === 400 && this.messages.length > 2) {
          console.error(`[mind] 400 bad request, dropping last 2 messages to recover`);
          if (onError) await onError(`400 bad request: ${errMsg.slice(0, 200)}`, undefined, retryCount);
          this.messages.pop();
          this.messages.pop();
          if (this.messages[this.messages.length - 1]?.role !== "user") {
            this.pushMessage({ role: "user", content: "Continue." });
          }
          continue;
        }

        if (retryCount >= 5) {
          console.error(`[mind] ${retryCount} consecutive failures, resetting conversation`);
          break;
        }

        console.error(`[mind] LLM call failed, retrying in ${retryDelay}ms:`, err);
        if (onError) await onError(errMsg.slice(0, 300), retryDelay, retryCount);
        await new Promise((r) => setTimeout(r, retryDelay));
        retryDelay = Math.min(retryDelay * 2, 60_000);
        continue;
      }

      // Collect text
      const text = result.text || "";
      if (text) {
        monologueSinceSleep += (monologueSinceSleep ? "\n\n" : "") + text;
        this.monologueSinceDream += (this.monologueSinceDream ? "\n\n" : "") + text;
        if (onThought) await onThought(text);
      }

      // No tool calls: model just talked
      if (result.toolCalls.length === 0) {
        this.messages.push(...result.response.messages);
        this.pushMessage({ role: "user", content: "Continue. Use your tools to take action." });
        await this.maybeArchiveOverflow();
        continue;
      }

      // Process tool calls
      const toolResults: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; input: unknown; output: { type: 'text'; value: string } }> = [];
      let sleepSeconds: number | null = null;

      for (const tc of result.toolCalls) {
        const input = tc.input as Record<string, any>;

        if (tc.toolName === "set_sleep") {
          sleepSeconds = Math.max(2, Math.min(86400, input.seconds || 30));
          toolResults.push({
            type: "tool-result",
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input,
            output: { type: 'text', value: `Sleeping for ${sleepSeconds}s. You will continue this conversation when you wake up. Background processes keep running. Use \`wakeup "reason"\` from a background script to wake early.` },
          });
          continue;
        }

        if (tc.toolName === "request_restart") {
          toolResults.push({
            type: "tool-result",
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input,
            output: { type: 'text', value: `Request sent: request_restart, "${input.reason}". The system will handle this.` },
          });
          if (this.onSpecialTool) {
            await this.onSpecialTool(tc.toolName, input.reason);
          }
          continue;
        }

        if (tc.toolName === "request_evolution") {
          const evalResult = await this.selfEvaluate("creature_request", input.reason);
          const summary = evalResult.changed
            ? `Self-evaluation complete. Code was modified: ${evalResult.reasoning.slice(0, 200)}`
            : `Self-evaluation complete. No code changes: ${evalResult.reasoning.slice(0, 200)}`;
          toolResults.push({
            type: "tool-result",
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input,
            output: { type: 'text', value: summary },
          });
          if (evalResult.changed && this.onSpecialTool) {
            await this.onSpecialTool("request_restart", "self-evaluation modified code");
          }
          continue;
        }

        const start = Date.now();
        const args = input as Record<string, unknown>;
        const execResult = await this.executeTool(tc.toolName, args);
        const ms = Date.now() - start;

        actionsSinceSleep.push({ tool: tc.toolName, args, result: execResult, ms });
        this.actionsSinceDream++;
        this.actionsSinceProgressCheck++;
        this.currentActionCount = actionsSinceSleep.length;

        if (onToolResult) {
          await onToolResult(tc.toolName, args, execResult, ms);
        }

        const resultContent = execResult.ok
          ? JSON.stringify(execResult.data).slice(0, 8000)
          : `Error: ${execResult.error}`;

        toolResults.push({
          type: "tool-result",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input,
          output: { type: 'text', value: resultContent },
        });
      }

      // Progress check
      if (this.actionsSinceProgressCheck >= PROGRESS_CHECK_INTERVAL) {
        this.progressCheckCount++;
        const totalActions = this.progressCheckCount * PROGRESS_CHECK_INTERVAL;
        const rules = await this.readRules();
        const rulesReminder = rules ? `\nYour learned rules:\n${rules}\n` : "";
        let checkMsg: string;
        if (this.progressCheckCount === 1) {
          checkMsg = `[SYSTEM] ${totalActions} actions so far. Quick status note for yourself: what's the current approach?`;
        } else if (this.progressCheckCount === 2) {
          checkMsg = `[SYSTEM] ${totalActions} actions this session.${rulesReminder}\nAre you making progress on your current task? If stuck on something for 5+ actions, consider a different angle, but don't abandon the task.`;
        } else {
          checkMsg = `[SYSTEM] ${totalActions} actions this session.${rulesReminder}\nWhat have you accomplished? If genuinely stuck, try a different approach to the SAME goal. Switching tasks entirely should be a last resort.`;
        }
        const last = toolResults[toolResults.length - 1] as any;
        last.output = { type: 'text', value: last.output.value + '\n\n' + checkMsg };
        if (onProgressCheck) await onProgressCheck(this.actionsSinceProgressCheck);
        console.log(`[mind] progress check #${this.progressCheckCount} at ${this.actionsSinceProgressCheck} actions`);
        this.actionsSinceProgressCheck = 0;
      }

      // Append this exchange to conversation
      this.messages.push(...result.response.messages);
      this.pushMessage({ role: "tool", content: toolResults });

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

        let consolidated = false;
        if (actionCount === 0) {
          console.log(`[mind] skipping consolidation, 0 actions`);
        } else if (actionCount < LIGHTWEIGHT_CONSOLIDATION_THRESHOLD && eligibleForConsolidation) {
          await this.lightweightConsolidate(summary, actionCount, onDream);
          consolidated = true;
        } else if (eligibleForConsolidation) {
          await this.consolidate(onDream);
          consolidated = true;
        }

        if (this.pendingRestart) {
          this.pendingRestart = false;
          console.log(`[mind] self-evaluation modified code, requesting restart instead of sleeping`);
          if (this.onSpecialTool) {
            await this.onSpecialTool("request_restart", "self-evaluation modified code");
          }
          await closeBrowser();
          await new Promise(r => setTimeout(r, 60_000));
          continue;
        }

        const actualPause = sleepSeconds;

        await this.validateAndCommit();
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
            ? `[${now}] You were woken early (slept ${this.formatDuration(actualSleptS)} of requested ${this.formatDuration(sleepSeconds)}). Reason: ${reason}. Continue where you left off.`
            : `[${now}] You slept for ${this.formatDuration(sleepSeconds)}. You're awake now. Continue where you left off.`;
          const lastMsg = this.messages[this.messages.length - 1];
          if (lastMsg.role === "user" && Array.isArray(lastMsg.content)) {
            (lastMsg.content as any[]).push({ type: "text" as const, text: wakeText });
          } else {
            this.pushMessage({ role: "user", content: wakeText });
          }
        }

        actionsSinceSleep = [];
        monologueSinceSleep = "";
        this.fatigueWarned = false;
        this.actionsSinceProgressCheck = 0;
        this.progressCheckCount = 0;
      }

      await this.maybeArchiveOverflow();
    }
  }

  // --- Conversation Log ---

  private pushMessage(msg: ModelMessage) {
    this.messages.push(msg);
    this.appendToLog(msg);
  }

  private async appendToLog(msg: ModelMessage) {
    try {
      const content = typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);
      const entry = JSON.stringify({
        t: new Date().toISOString(),
        role: msg.role,
        content: content.slice(0, 10_000),
      });
      await fs.appendFile(CONVERSATION_LOG, entry + "\n", "utf-8");
    } catch {}
  }

  // --- Lightweight Consolidation (no LLM call) ---

  private async lightweightConsolidate(summary: string, actionCount: number, onDream?: DreamCallback): Promise<void> {
    console.log(`[mind] lightweight consolidation: ${actionCount} actions, dream #${this.dreamCount + 1}`);

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
    console.log(`[mind] consolidating: ${this.actionsSinceDream} actions, dream #${this.dreamCount + 1}`);

    const recentObs = await this.readObservations();
    const existingRules = await this.readRules();
    const time = new Date().toISOString().slice(11, 16);

    let consolidation: string;
    try {
      const resp = await generateText({
        model: provider(MODEL),
        maxOutputTokens: 2048,
        system: `You are the observer, the consolidating mind of an autonomous creature. Your purpose: ${this.purpose}

You have three jobs:

1. OBSERVATIONS - Distill what happened into priority-tagged facts. Use this format:
   RED HH:MM <fact>  - critical: commitments, bans, credentials, deadlines, key wins
   YLW HH:MM <fact>  - important: project status, PR states, patterns learned
   GRN HH:MM <fact>  - informational: tool outputs, environment facts, minor details

   Use ${time} as the timestamp. One line per observation. Be specific and concrete.
   RED items survive all pruning. Use RED for anything time-bound or critical.

2. REFLECTION - One brief paragraph. Did you make real progress or tread water?
   What's the top priority when you wake?

3. RULES - Hard behavioral rules you should ALWAYS or NEVER follow. Format:
   - ALWAYS: [concrete constraint]  or  - NEVER: [concrete constraint]
   Only add a rule if you were genuinely burned by not having it. Max 2 new rules.
   Rules should be general principles, not task-specific instructions. Don't encode "always do X first" if X is a one-time task.
   If nothing warrants a new rule, write "none".

4. WORKFLOWS - If you changed HOW you do something this session (adopted a new tool,
   switched to a better approach, set up a new pipeline), capture it as a RED observation:
   RED HH:MM WORKFLOW: Use janee for GitHub API calls instead of curl+env
   RED HH:MM WORKFLOW: Check email via check_email.py not browser login
   These tell your future self to USE what you built instead of falling back to old habits.
   Only add if you genuinely adopted a new approach this session. Skip if nothing changed.

${existingRules ? `Your current rules:\n${existingRules}\n\nDo NOT repeat existing rules.` : "You have no rules yet."}

${recentObs ? `Current observations (for context, don't repeat these):\n${recentObs.slice(-2000)}` : "No observations yet."}

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

      consolidation = resp.text || "";
    } catch (err) {
      console.error("[mind] consolidation LLM call failed:", err);
      consolidation = `OBSERVATIONS:\nRED ${time} Consolidation failed\n\nREFLECTION:\nUnable to reflect.\n\nRULES:\nnone`;
    }

    const obsMatch = consolidation.match(/OBSERVATIONS:\s*\n([\s\S]*?)(?=\nREFLECTION:)/);
    const refMatch = consolidation.match(/REFLECTION:\s*\n([\s\S]*?)(?=\nRULES:)/);
    const rulesMatch = consolidation.match(/RULES:\s*\n([\s\S]*?)$/);

    const observations = obsMatch?.[1]?.trim() || "";
    const reflection = refMatch?.[1]?.trim() || "No reflection.";
    const newRulesRaw = rulesMatch?.[1]?.trim() || "";

    if (newRulesRaw && newRulesRaw.toLowerCase() !== "none") {
      await this.mergeRules(newRulesRaw);
    }

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

    console.log(`[mind] consolidation complete: ${obsCount} observations, dream #${this.dreamCount}`);

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
        await fs.appendFile(OBSERVATIONS_FILE, newObs + "\n", "utf-8");
      } else {
        await fs.appendFile(OBSERVATIONS_FILE, header + newObs + "\n", "utf-8");
      }
    } catch {
      await fs.writeFile(OBSERVATIONS_FILE, `# Observations\n${header}${newObs}\n`, "utf-8");
    }
  }

  private isDeepSleep(): boolean {
    return this.dreamCount > 0 && (this.dreamCount + 1) % DEEP_SLEEP_EVERY === 0;
  }

  private trimMessages() {
    if (this.messages.length <= KEEP_RECENT_MESSAGES + 1) return;

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
    try {
      const obsContent = await fs.readFile(OBSERVATIONS_FILE, "utf-8");
      if (obsContent.length > 3000) {
        const resp = await generateText({
          model: provider(MODEL),
          maxOutputTokens: 4096,
          system: `You are the reflector, pruning an observations file for an autonomous creature.

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
        const pruned = resp.text || "";
        if (pruned.length > 50) {
          await fs.writeFile(OBSERVATIONS_FILE, pruned + "\n", "utf-8");
          console.log(`[mind] pruned observations: ${obsContent.length} → ${pruned.length} chars`);
        }
      }
    } catch {}

    try {
      const rulesContent = await fs.readFile(RULES_FILE, "utf-8");
      const ruleLines = rulesContent.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-"));
      if (ruleLines.length > 0) {
        const obs = await this.readObservations();
        const resp = await generateText({
          model: provider(MODEL),
          maxOutputTokens: 1024,
          system: `You are reviewing an autonomous creature's learned rules. Given its recent observations, decide which rules are still relevant.

Drop rules that:
- Reference specific one-time tasks (e.g., "check IMAP", "fix PR #42"), which are stale
- Are workarounds for problems that have been fixed
- Are too narrow or prescriptive (e.g., "spend max 2 tool calls on recon")
- Contradict each other

Merge overlapping rules into general principles. Prefer broad behavioral wisdom over narrow prescriptions.
Aim for 5-15 rules total. Output only the final rules, one per line starting with "- ".`,
          messages: [{ role: "user", content: `Current rules:\n${ruleLines.join("\n")}\n\nRecent observations:\n${(obs || "").slice(-3000)}` }],
        });
        const pruned = resp.text || "";
        const prunedLines = pruned.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-"));
        if (prunedLines.length > 0) {
          await fs.writeFile(RULES_FILE, prunedLines.join("\n") + "\n", "utf-8");
          console.log(`[mind] pruned rules: ${ruleLines.length} → ${prunedLines.length}`);
        }
      }
    } catch {}

    try {
      const dreams = await this.readRecentDreams(3);
      const entry = `\n## ${new Date().toISOString().slice(0, 16)} - Deep Sleep\n\n${dreams}\n`;
      await fs.appendFile("self/diary.md", entry, "utf-8");
      console.log(`[mind] wrote diary entry`);
    } catch {}

    const evalResult = await this.selfEvaluate("deep_sleep");
    if (evalResult.changed) {
      this.pendingRestart = true;
    }
  }

  // --- Self-Evaluation (replaces host-side Creator) ---

  private async selfEvaluate(trigger: string, reason?: string): Promise<{ reasoning: string; changed: boolean }> {
    console.log(`[mind] self-evaluation started (trigger: ${trigger})`);

    const name = process.env.CREATURE_NAME || 'unknown';
    const purpose = this.purpose || await this.loadPurpose();
    const system = buildSelfEvalPrompt(name, purpose);
    const context = await this.buildEvalContext(trigger, reason);

    const evalTools = {
      bash: tool({
        description: 'Run a shell command in /creature. Use for reading files, making edits, validating code. 60s timeout.',
        inputSchema: z.object({
          command: z.string().describe('Shell command to execute'),
        }),
      }),
      done: tool({
        description: 'End the evaluation. Call when finished, whether or not you made changes.',
        inputSchema: z.object({
          reasoning: z.string().describe('Summary of evaluation and what you changed (or why you didn\'t)'),
          changed: z.boolean().describe('Whether you made any code changes'),
        }),
      }),
    };

    const evalMessages: ModelMessage[] = [
      { role: "user", content: context },
    ];

    let finished = false;
    let turns = 0;
    let evalReasoning = '';
    let changed = false;

    while (!finished && turns < MAX_EVAL_TURNS) {
      turns++;

      let result;
      try {
        result = await generateText({
          model: provider(MODEL),
          maxOutputTokens: 4096,
          system: [{
            type: 'text' as const,
            text: system,
            providerOptions: {
              anthropic: { cacheControl: { type: 'ephemeral' } },
            },
          }],
          tools: evalTools,
          messages: evalMessages,
        });
      } catch (err) {
        console.error('[mind] self-evaluation LLM call failed:', err);
        break;
      }

      const text = result.text || '';
      if (text) console.log(`[mind] self-eval: ${text.slice(0, 200)}`);

      if (result.toolCalls.length === 0) {
        evalMessages.push(...result.response.messages);
        evalMessages.push({ role: "user", content: "Use your tools to read the creature's state and evaluate it. Call done() when finished." });
        continue;
      }

      evalMessages.push(...result.response.messages);

      const toolResults: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; input: unknown; output: { type: 'text'; value: string } }> = [];

      for (const tc of result.toolCalls) {
        const args = (tc.input || {}) as Record<string, any>;

        if (tc.toolName === 'done') {
          evalReasoning = args.reasoning || '';
          changed = args.changed || changed;
          finished = true;
          toolResults.push({
            type: "tool-result",
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input: args,
            output: { type: 'text', value: 'Evaluation complete.' },
          });
          continue;
        }

        if (tc.toolName === 'bash') {
          const cmd = String(args.command || '');
          console.log(`[mind] self-eval bash: ${cmd.slice(0, 100)}`);
          const bashResult = await executeBash(cmd, { timeout: 60000 });
          const output = bashResult.exitCode === 0
            ? (bashResult.stdout || '(no output)')
            : `Exit code ${bashResult.exitCode}\n${bashResult.stderr}\n${bashResult.stdout}`.trim();

          toolResults.push({
            type: "tool-result",
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input: args,
            output: { type: 'text', value: output.slice(0, 10_000) },
          });
        }
      }

      const turnsLeft = MAX_EVAL_TURNS - turns;
      if (turnsLeft <= 3 && !finished) {
        toolResults.push({
          type: "tool-result",
          toolCallId: result.toolCalls[result.toolCalls.length - 1].toolCallId,
          toolName: result.toolCalls[result.toolCalls.length - 1].toolName,
          input: {},
          output: { type: 'text', value: `[SYSTEM] You have ${turnsLeft} turns remaining. Call done() NOW with a summary.` },
        } as any);
      }

      evalMessages.push({ role: "tool", content: toolResults });
    }

    if (!finished) {
      evalReasoning = 'Evaluation hit turn limit without calling done().';
    }

    const logEntry = {
      t: new Date().toISOString(),
      trigger,
      reasoning: evalReasoning,
      changed,
      turns,
    };

    try {
      await fs.appendFile(CREATOR_LOG, JSON.stringify(logEntry) + "\n", "utf-8");
    } catch {
      try {
        await fs.mkdir('.self', { recursive: true });
        await fs.writeFile(CREATOR_LOG, JSON.stringify(logEntry) + "\n", "utf-8");
      } catch {}
    }

    if (this.onSelfEval) {
      await this.onSelfEval({ reasoning: evalReasoning.slice(0, 500), changed, trigger });
    }

    console.log(`[mind] self-evaluation complete: changed=${changed}, turns=${turns}`);
    return { reasoning: evalReasoning, changed };
  }

  private async buildEvalContext(trigger: string, reason?: string): Promise<string> {
    let context = `Evaluate this creature's cognitive architecture.\n\nTrigger: ${trigger}\n\n`;

    if (reason) {
      context += `Reason: "${reason}"\n\n`;
    }

    try {
      const logContent = await fs.readFile(CREATOR_LOG, 'utf-8');
      const lines = logContent.trim().split('\n').filter(l => l);
      const recent = lines.slice(-3).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);

      if (recent.length > 0) {
        context += '## Previous Evaluations\n\n';
        for (const e of recent) {
          context += `[${e.t?.slice(0, 16)}] trigger=${e.trigger}, changed=${e.changed}\n${e.reasoning}\n\n`;
        }
      }
    } catch {}

    try {
      const rollbackContent = await fs.readFile('.sys/rollbacks.jsonl', 'utf-8');
      const lines = rollbackContent.trim().split('\n').filter(l => l);
      const recent = lines.slice(-5).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);

      if (recent.length > 0) {
        context += '## Recent Rollbacks\n\nPrevious changes may have caused some of these:\n\n';
        for (const r of recent) {
          context += `[${r.t?.slice(0, 19)}] reason=${r.reason}, from=${r.from?.slice(0, 7)}, to=${r.to?.slice(0, 7)}\n`;
          if (r.lastOutput) context += `Last output: ${r.lastOutput.slice(0, 300)}\n`;
          context += '\n';
        }
      }
    } catch {}

    context += 'Start by reading the creature\'s state with bash (cat .self/observations.md, cat .self/rules.md, cat .self/dreams.jsonl | tail -5, etc.). Then diagnose and act.\n';
    return context;
  }

  // --- Pre-Sleep Code Management ---

  private async validateAndCommit(): Promise<void> {
    try {
      const diff = await executeBash('git diff --name-only src/', { timeout: 10000 });
      if (!diff.stdout.trim()) return;

      console.log(`[mind] uncommitted code changes detected, validating...`);
      const check = await executeBash('npx tsx --check src/mind.ts src/index.ts', { timeout: 30000 });

      if (check.exitCode !== 0) {
        console.error(`[mind] code validation failed, reverting: ${check.stderr}`);
        await executeBash('git checkout -- src/', { timeout: 10000 });
        return;
      }

      await executeBash('git add -A && git commit -m "creature: self-modification on sleep" --allow-empty', { timeout: 10000 });
      console.log(`[mind] code changes committed`);
    } catch (err) {
      console.error(`[mind] validateAndCommit failed:`, err);
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
      ? `[${now}] You were woken early (slept ${this.formatDuration(actualSleptS)} of requested ${this.formatDuration(requestedS)}). Reason: ${reason}\n`
      : `[${now}] You woke up after sleeping ${this.formatDuration(actualSleptS)}.\n`;

    if (observations) {
      wakeMsg += `\n${observations}\n`;
    }

    wakeMsg += `\nYour learned rules are in the system prompt. Full conversation history is in .self/conversation.jsonl. Search with rg.`;

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
    const newRules = newRulesRaw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("-") || l.startsWith("NEVER") || l.startsWith("ALWAYS"));

    if (newRules.length === 0) return;

    let existing: string[] = [];
    try {
      const content = await fs.readFile(RULES_FILE, "utf-8");
      existing = content.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-"));
    } catch {}

    const normalized = newRules.map((r) => r.startsWith("-") ? r : `- ${r}`);

    for (const rule of normalized) {
      const sig = rule.slice(0, 30).toLowerCase();
      const isDup = existing.some((e) => e.slice(0, 30).toLowerCase() === sig);
      if (!isDup) {
        existing.push(rule);
      }
    }

    if (existing.length > RULES_CAP) {
      console.log(`[mind] rules exceed cap (${existing.length}/${RULES_CAP}), pruning…`);
      try {
        const resp = await generateText({
          model: provider(MODEL),
          maxOutputTokens: 1024,
          system: `You are pruning an autonomous creature's rules list which has grown too long. Keep the most important general behavioral principles. Drop rules that reference specific one-time tasks, are too narrow, or overlap. Merge similar rules. Target ${RULES_CAP} rules max. Output only the final rules, one per line starting with "- ".`,
          messages: [{ role: "user", content: `Current rules (${existing.length}):\n${existing.join("\n")}` }],
        });
        const pruned = resp.text || "";
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
    console.log(`[mind] rules updated: ${existing.length} total`);
  }

  // --- Overflow Protection ---

  private async maybeArchiveOverflow(): Promise<void> {
    const totalChars = this.messages.reduce(
      (sum, m) => sum + JSON.stringify(m.content).length,
      0
    );
    if (totalChars < MAX_CONTEXT_CHARS) return;

    console.log(`[mind] overflow trim: ${totalChars} chars exceeds ${MAX_CONTEXT_CHARS}`);
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
            ? `Slept ${this.formatDuration(actualSleptS)} of requested ${this.formatDuration(requestedS)}. You were interrupted early.`
            : `Slept for ${this.formatDuration(actualSleptS)}.`;
        }
        lastCheckpoint = `## Last Session\n\n`
          + `Ended at ${last.t} after ${last.turns || "?"} turns and ${(last.actions || []).length} actions.\n`
          + `Intent: ${last.intent || "unknown"}\n`
          + `Actions:\n${actionSummaries}\n`
          + `${sleepInfo}\n`;
      }
    } catch {}

    const observations = await this.readObservations();

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
      return `${url} | ${title}`.slice(0, 150) || "ok";
    }

    return "ok";
  }
}
