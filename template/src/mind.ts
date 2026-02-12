import fs from 'node:fs/promises';

import Anthropic from '@anthropic-ai/sdk';

import { Memory } from './memory.js';
import {
  bashTool,
  executeBash,
} from './tools/bash.js';
import {
  browserTool,
  executeBrowser,
} from './tools/browser.js';

const MAX_CONTEXT_CHARS = 100_000;
const KEEP_RECENT_MESSAGES = 20;
const ITERATIONS_FILE = ".self/iterations.jsonl";
const CONVERSATION_LOG = ".self/conversation.jsonl";
const OBSERVATIONS_FILE = ".self/observations.md";
const DREAMS_FILE = ".self/dreams.jsonl";
const PRIORITIES_FILE = ".self/priorities.md";
const MODEL = "claude-sonnet-4-5-20250929";

// Fatigue constants
const FATIGUE_WARNING = 60;
const FATIGUE_LIMIT = 80;
const MIN_DREAM_INTERVAL_MS = 10 * 60 * 1000; // 10 min
const QUICK_NAP_THRESHOLD = 30; // seconds
const DEEP_SLEEP_EVERY = 10; // every N dreams
const DEEP_SLEEP_PAUSE = 300; // 5 min forced pause

const sleepTool: Anthropic.Tool = {
  name: "set_sleep",
  description:
    "Pause and sleep for N seconds before continuing. Use this to pace yourself — e.g. after posting something, sleep before checking engagement. Min 2s, max 300s.",
  input_schema: {
    type: "object" as const,
    properties: {
      seconds: {
        type: "number",
        description: "Seconds to sleep (2-300)",
      },
    },
    required: ["seconds"],
  },
};

function buildSystemPrompt(purpose: string): string {
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

## Your Tools

You have bash, browser, and set_sleep as tools. Use them freely — you will see the results
of each tool call before deciding your next action.

**bash** — full power of a Unix machine. Write scripts, install packages, spin up servers,
compile code, make API calls with curl — anything a developer can do from a terminal.

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

**set_sleep** — pause for N seconds before continuing (2-300s). Use this to pace yourself.
After sleeping, you'll continue this same conversation with full memory of what you've done.
Don't spend all your time gathering information — ACT, then sleep, then check results.

If you think "I can't do X because I'm a bot" — you're wrong. You have bash on a real machine
and a real browser. If a tool isn't installed, install it. If a library is missing, add it.
You have no GUI and no terminal for interactive prompts, but you have everything else.

## Memory & History

Your full conversation history is logged to .self/conversation.jsonl — you can search it:
  rg "keyword" .self/conversation.jsonl
  jq -r 'select(.role=="assistant") | .content' .self/conversation.jsonl | rg -i "pattern"

When you sleep, your recent experience is compressed into observations (.self/observations.md)
and reflections (.self/dreams.jsonl). These are injected when you wake up.

You also have .self/priorities.md — your own living document of what matters most right now.

## Messages

Your creator may leave messages for you in MESSAGES.md (in your root directory). Check it
occasionally — especially after waking from sleep. These are one-way instructions: your
creator will never read that file, so don't write replies there. Act on what they say.

## Self-Modification

If you can't do something, change yourself until you can. Install tools, add dependencies,
rewrite your own code, alter your environment. You are not fixed — you are the thing that
changes itself. Edit files, commit, and the host will roll you back if you break.
That safety net is there so you can be bold.

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

  constructor(memory: Memory) {
    this.client = new Anthropic();
    this.memory = memory;
  }

  inject(text: string) {
    const wrapped = `[MESSAGE FROM YOUR CREATOR — this is a direct interrupt. Your creator cannot hear you or read your responses. Process this message and continue autonomously.]\n\n${text}`;
    const last = this.messages[this.messages.length - 1];
    if (last?.role === "user") {
      if (typeof last.content === "string") {
        last.content += "\n\n" + wrapped;
      } else if (Array.isArray(last.content)) {
        last.content.push({ type: "text", text: wrapped });
      }
    } else {
      this.pushMessage({ role: "user", content: wrapped });
    }
    console.log(`[mind] injected creator message: ${text.slice(0, 80)}`);
  }

  async run(
    onToolResult?: ToolResultCallback,
    onSleep?: SleepCallback,
    onThought?: ThoughtCallback,
    onDream?: DreamCallback,
  ): Promise<never> {
    this.purpose = await this.loadPurpose();
    this.systemPrompt = buildSystemPrompt(this.purpose);
    this.tools = [bashTool as Anthropic.Tool, browserTool as Anthropic.Tool, sleepTool];

    const initialContext = await this.buildInitialContext();
    this.messages = [];
    this.pushMessage({ role: "user", content: initialContext });

    let actionsSinceSleep: ActionRecord[] = [];
    let monologueSinceSleep = "";
    let retryDelay = 1000;

    while (true) {
      // Check fatigue before each LLM call
      if (this.actionsSinceDream >= FATIGUE_LIMIT) {
        console.log(`[mind] fatigue limit hit (${this.actionsSinceDream} actions) — forcing consolidation`);
        this.pushMessage({ role: "user", content: "[SYSTEM] You're exhausted. Sleeping now for memory consolidation." } as any);

        const summary = this.extractSummary(monologueSinceSleep);
        await this.saveCheckpoint(summary, actionsSinceSleep, DEEP_SLEEP_PAUSE);
        if (onSleep) await onSleep(DEEP_SLEEP_PAUSE, "forced consolidation", actionsSinceSleep.length);

        await this.consolidate(onDream);

        console.log(`[mind] forced sleep ${DEEP_SLEEP_PAUSE}s`);
        await new Promise((r) => setTimeout(r, DEEP_SLEEP_PAUSE * 1000));

        await this.wakeUp(DEEP_SLEEP_PAUSE);
        actionsSinceSleep = [];
        monologueSinceSleep = "";
        this.fatigueWarned = false;
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

      let response: Anthropic.Message;
      try {
        response = await this.client.messages.create({
          model: MODEL,
          max_tokens: 4096,
          system: this.systemPrompt,
          tools: this.tools,
          messages: this.messages,
        });
        retryDelay = 1000;
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
          sleepSeconds = Math.max(2, Math.min(300, input.seconds || 30));
          toolResults.push({
            type: "tool_result" as const,
            tool_use_id: tu.id,
            content: `Sleeping for ${sleepSeconds}s. You will continue this conversation when you wake up.`,
          });
          continue;
        }

        const start = Date.now();
        const args = tu.input as Record<string, unknown>;
        const result = await this.executeTool(tu.name, args);
        const ms = Date.now() - start;

        actionsSinceSleep.push({ tool: tu.name, args, result, ms });
        this.actionsSinceDream++;

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

        // Decide whether to consolidate
        const shouldConsolidate = sleepSeconds >= QUICK_NAP_THRESHOLD
          && (Date.now() - this.lastDreamTime >= MIN_DREAM_INTERVAL_MS);

        if (shouldConsolidate) {
          await this.consolidate(onDream);
        }

        const actualPause = shouldConsolidate && this.isDeepSleep()
          ? Math.max(sleepSeconds, DEEP_SLEEP_PAUSE)
          : sleepSeconds;

        console.log(`[mind] sleeping for ${actualPause}s${shouldConsolidate ? " (with consolidation)" : ""}`);
        await new Promise((r) => setTimeout(r, actualPause * 1000));

        if (shouldConsolidate) {
          await this.wakeUp(actualPause);
        } else {
          // Simple wake — just append to existing message
          const now = new Date().toISOString();
          const lastMsg = this.messages[this.messages.length - 1];
          if (lastMsg.role === "user" && Array.isArray(lastMsg.content)) {
            (lastMsg.content as any[]).push({
              type: "text" as const,
              text: `[${now}] You slept for ${sleepSeconds}s. You're awake now. Continue where you left off.`,
            });
          } else {
            this.pushMessage({
              role: "user",
              content: `[${now}] You slept for ${sleepSeconds}s. You're awake now. Continue where you left off.`,
            });
          }
        }

        actionsSinceSleep = [];
        monologueSinceSleep = "";
        this.fatigueWarned = false;
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

  // --- Consolidation (replaces maybeArchive) ---

  private async consolidate(onDream?: DreamCallback): Promise<void> {
    console.log(`[mind] consolidating — ${this.actionsSinceDream} actions, dream #${this.dreamCount + 1}`);

    const lastDream = await this.readLastDream();
    const recentObs = await this.readRecentObservations(10);

    // Single LLM call for observations + reflection
    let consolidation: string;
    try {
      const resp = await this.client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: `You are the consolidating mind of an autonomous creature, processing a period of activity before sleep. Your purpose: ${this.purpose}

You have two jobs:

1. OBSERVATIONS — Distill what happened into prioritized facts:
   [!] Important fact or achievement
   [.] Minor detail or resolved issue
   One line per observation. Be specific and concrete.

2. REFLECTION — Briefly reflect on your progress. Be honest:
   - Did I make real progress or tread water?
   - What pattern am I stuck in?
   - What's my top priority when I wake?

Previous dream: ${lastDream || "none"}
Recent observations: ${recentObs || "none yet"}

Respond in exactly this format:

OBSERVATIONS:
[!] ...
[.] ...

REFLECTION:
...

PRIORITY:
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
      consolidation = "OBSERVATIONS:\n[!] Consolidation failed\n\nREFLECTION:\nUnable to reflect.\n\nPRIORITY:\nContinue previous task.";
    }

    // Parse response
    const obsMatch = consolidation.match(/OBSERVATIONS:\s*\n([\s\S]*?)(?=\nREFLECTION:)/);
    const refMatch = consolidation.match(/REFLECTION:\s*\n([\s\S]*?)(?=\nPRIORITY:)/);
    const priMatch = consolidation.match(/PRIORITY:\s*\n([\s\S]*?)$/);

    const observations = obsMatch?.[1]?.trim() || "";
    const reflection = refMatch?.[1]?.trim() || "No reflection.";
    const priority = priMatch?.[1]?.trim() || "Continue.";

    // Write observations
    if (observations) {
      const header = `\n## ${new Date().toISOString().slice(0, 16)} (dream #${this.dreamCount + 1})\n`;
      try {
        await fs.appendFile(OBSERVATIONS_FILE, header + observations + "\n", "utf-8");
      } catch {
        await fs.writeFile(OBSERVATIONS_FILE, header + observations + "\n", "utf-8");
      }
    }

    const obsCount = (observations.match(/^\[/gm) || []).length;

    // Write dream entry
    const dreamEntry = {
      t: new Date().toISOString(),
      actions: this.actionsSinceDream,
      reflection,
      priority,
      observations: obsCount,
      deep: this.isDeepSleep(),
    };
    try {
      await fs.appendFile(DREAMS_FILE, JSON.stringify(dreamEntry) + "\n", "utf-8");
    } catch {
      await fs.writeFile(DREAMS_FILE, JSON.stringify(dreamEntry) + "\n", "utf-8");
    }

    // Trim old messages — keep recent, replace old with consolidation marker
    this.trimMessages();

    // Deep sleep extra processing
    if (this.isDeepSleep()) {
      console.log(`[mind] deep sleep triggered (dream #${this.dreamCount + 1})`);
      await this.deepSleep();
    }

    // Update state
    this.dreamCount++;
    this.actionsSinceDream = 0;
    this.lastDreamTime = Date.now();
    this.monologueSinceDream = "";

    console.log(`[mind] consolidation complete — ${obsCount} observations, dream #${this.dreamCount}`);

    if (onDream) {
      await onDream({ reflection, priority, observations: obsCount, deep: dreamEntry.deep });
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
      { role: "user", content: "Earlier context has been consolidated into .self/observations.md. Search with rg if you need it." },
      ...recentMessages,
    ];
    console.log(`[mind] trimmed to ${this.messages.length} messages`);
  }

  // --- Deep Sleep ---

  private async deepSleep(): Promise<void> {
    // 1. Prune observations
    try {
      const obsContent = await fs.readFile(OBSERVATIONS_FILE, "utf-8");
      if (obsContent.length > 2000) {
        const resp = await this.client.messages.create({
          model: MODEL,
          max_tokens: 2048,
          system: `You are pruning an observations file for an autonomous creature. Keep all [!] entries that are still relevant. Drop all [.] entries older than the last 2 sections. Keep section headers. Output only the pruned file content, nothing else.`,
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
      // No observations file yet, that's fine
    }

    // 2. Rewrite priorities
    try {
      const dreams = await this.readRecentDreams(5);
      const obs = await this.readRecentObservations(20);
      const resp = await this.client.messages.create({
        model: MODEL,
        max_tokens: 512,
        system: `Based on the creature's recent dreams and observations, write a concise priorities document. List the top 3-5 priorities with one line each. Output only the priorities, no preamble.`,
        messages: [{ role: "user", content: `Dreams:\n${dreams}\n\nObservations:\n${obs}` }],
      });
      const priorities = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      if (priorities.length > 10) {
        await fs.writeFile(PRIORITIES_FILE, `# Priorities\n\nUpdated: ${new Date().toISOString().slice(0, 16)}\n\n${priorities}\n`, "utf-8");
        console.log(`[mind] rewrote priorities`);
      }
    } catch (err) {
      console.error("[mind] failed to rewrite priorities:", err);
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

  private async wakeUp(duration: number): Promise<void> {
    const lastDream = await this.readLastDream();
    const recentObs = await this.readRecentObservations(15);
    const priorities = await this.readPriorities();

    const now = new Date().toISOString();
    let wakeMsg = `[${now}] You woke up after sleeping ${duration}s.\n`;

    if (lastDream) {
      const dream = JSON.parse(lastDream);
      wakeMsg += `\nDuring sleep you reflected:\n${dream.reflection || "..."}\n`;
      wakeMsg += `\nYour priority: ${dream.priority || "Continue."}\n`;
    }

    if (priorities) {
      wakeMsg += `\nYour priorities:\n${priorities}\n`;
    }

    if (recentObs) {
      wakeMsg += `\nRecent observations:\n${recentObs}\n`;
    }

    wakeMsg += `\nFull history: .self/conversation.jsonl and .self/observations.md — search with rg or jq.\n`;
    wakeMsg += `Check MESSAGES.md for any new instructions from your creator.`;

    // Append to existing user message or create new one
    const lastMsg = this.messages[this.messages.length - 1];
    if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
      (lastMsg.content as any[]).push({ type: "text" as const, text: wakeMsg });
    } else {
      this.pushMessage({ role: "user", content: wakeMsg });
    }
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

  private async readRecentObservations(n: number): Promise<string> {
    try {
      const content = await fs.readFile(OBSERVATIONS_FILE, "utf-8");
      const lines = content.trim().split("\n");
      return lines.slice(-n).join("\n");
    } catch {
      return "";
    }
  }

  private async readPriorities(): Promise<string> {
    try {
      return (await fs.readFile(PRIORITIES_FILE, "utf-8")).trim();
    } catch {
      return "";
    }
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
          const { command, timeout } = args as { command: string; timeout?: number };
          const result = await executeBash(command, { timeout });

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
        lastCheckpoint = `## Last Session\n\n`
          + `Ended at ${last.t} after ${last.turns || "?"} turns and ${(last.actions || []).length} actions.\n`
          + `Intent: ${last.intent || "unknown"}\n`
          + `Actions:\n${actionSummaries}\n`
          + `Slept for ${last.sleep_s || "?"}s before this restart.\n`;
      }
    } catch {
      // No history — fresh creature
    }

    // Include recent observations and priorities on startup
    const recentObs = await this.readRecentObservations(15);
    const priorities = await this.readPriorities();
    const lastDream = await this.readLastDream();

    let context = "";
    if (lastCheckpoint) context += lastCheckpoint + "\n";
    if (lastDream) {
      try {
        const dream = JSON.parse(lastDream);
        context += `## Last Dream\n\nReflection: ${dream.reflection}\nPriority: ${dream.priority}\n\n`;
      } catch {}
    }
    if (priorities) context += `## Priorities\n\n${priorities}\n\n`;
    if (recentObs) context += `## Recent Observations\n\n${recentObs}\n\n`;
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
