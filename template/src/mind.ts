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
const MODEL = "claude-sonnet-4-5-20250929";

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

export class Mind {
  private client: Anthropic;
  private memory: Memory;
  private messages: Anthropic.MessageParam[] = [];
  private systemPrompt = "";
  private tools: Anthropic.Tool[] = [];

  constructor(memory: Memory) {
    this.client = new Anthropic();
    this.memory = memory;
  }

  async run(onToolResult?: ToolResultCallback, onSleep?: SleepCallback): Promise<never> {
    const purpose = await this.loadPurpose();
    this.systemPrompt = buildSystemPrompt(purpose);
    this.tools = [bashTool as Anthropic.Tool, browserTool as Anthropic.Tool, sleepTool];

    // Build initial context from last session's checkpoint
    const initialContext = await this.buildInitialContext();
    this.messages = [{ role: "user", content: initialContext }];

    let actionsSinceSleep: ActionRecord[] = [];
    let monologueSinceSleep = "";
    let retryDelay = 1000;

    while (true) {
      let response: Anthropic.Message;
      try {
        response = await this.client.messages.create({
          model: MODEL,
          max_tokens: 4096,
          system: this.systemPrompt,
          tools: this.tools,
          messages: this.messages,
        });
        retryDelay = 1000; // reset on success
      } catch (err: any) {
        if (err?.status === 400 && this.messages.length > 2) {
          // Bad request — messages are likely corrupted (orphaned tool_results, etc.)
          // Drop the last exchange and retry
          console.error(`[mind] 400 bad request — dropping last 2 messages to recover`);
          this.messages.pop();
          this.messages.pop();
          // Ensure messages end with a user message for the next LLM call
          if (this.messages[this.messages.length - 1]?.role !== "user") {
            this.messages.push({ role: "user", content: "Continue." });
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
      }

      // Extract tool uses
      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      // No tool calls — model just talked. Append and prompt for action.
      if (toolUses.length === 0) {
        this.messages.push({ role: "assistant", content: response.content });
        this.messages.push({ role: "user", content: "Continue. Use your tools to take action." });
        await this.maybeArchive();
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
      this.messages.push({ role: "assistant", content: response.content });
      this.messages.push({ role: "user", content: toolResults });

      // Handle sleep
      if (sleepSeconds !== null) {
        // Intent = first line of the LAST text block (what the creature was thinking most recently)
        const blocks = monologueSinceSleep.split("\n\n").filter((s) => s.trim());
        const lastBlock = blocks[blocks.length - 1] || monologueSinceSleep;
        const intent = lastBlock.split("\n").find((l) => l.trim()) || "";
        const summary = intent.slice(0, 200);

        // Save checkpoint
        await this.saveCheckpoint(intent, actionsSinceSleep, sleepSeconds);

        if (onSleep) {
          await onSleep(sleepSeconds, summary, actionsSinceSleep.length);
        }

        console.log(`[mind] sleeping for ${sleepSeconds}s`);
        await new Promise((r) => setTimeout(r, sleepSeconds! * 1000));

        // Wake up — append to the existing user message to avoid consecutive user messages
        const now = new Date().toISOString();
        const lastMsg = this.messages[this.messages.length - 1];
        if (lastMsg.role === "user" && Array.isArray(lastMsg.content)) {
          (lastMsg.content as any[]).push({
            type: "text" as const,
            text: `[${now}] You slept for ${sleepSeconds}s. You're awake now. Continue where you left off.`,
          });
        } else {
          // Shouldn't happen, but handle gracefully
          this.messages.push({
            role: "user",
            content: `[${now}] You slept for ${sleepSeconds}s. You're awake now. Continue where you left off.`,
          });
        }

        // Reset per-sleep trackers
        actionsSinceSleep = [];
        monologueSinceSleep = "";
      }

      // Archive if context is getting too long
      await this.maybeArchive();
    }
  }

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

  private async loadPurpose(): Promise<string> {
    try {
      return (await fs.readFile("PURPOSE.md", "utf-8")).trim();
    } catch {
      return "No PURPOSE.md found. Create one to give yourself direction.";
    }
  }

  private async buildInitialContext(): Promise<string> {
    // Try to load the last checkpoint from iterations.jsonl for cross-restart continuity
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

    let context = "";
    if (lastCheckpoint) {
      context += lastCheckpoint + "\n";
    }
    context += "You just woke up. What do you want to do?\n";
    return context;
  }

  private async maybeArchive(): Promise<void> {
    const totalChars = this.messages.reduce(
      (sum, m) => sum + JSON.stringify(m.content).length,
      0
    );

    if (totalChars < MAX_CONTEXT_CHARS) return;

    console.log(`[mind] archiving — ${totalChars} chars exceeds ${MAX_CONTEXT_CHARS}`);

    // Find a safe split point: must be right before an assistant message.
    // This ensures no tool_result blocks in the recent set reference
    // tool_use blocks that got archived away.
    let splitAt = Math.max(1, this.messages.length - KEEP_RECENT_MESSAGES);

    while (splitAt < this.messages.length - 2) {
      if (this.messages[splitAt].role === "assistant") break;
      splitAt++;
    }

    // If no safe split found, bail
    if (splitAt >= this.messages.length - 2) return;

    const oldMessages = this.messages.slice(0, splitAt);
    const recentMessages = this.messages.slice(splitAt); // starts with assistant

    const summary = await this.summarizeMessages(oldMessages);

    // user(summary) → assistant(recent[0]) → user(recent[1]) → ...
    // This preserves alternation and tool_use/tool_result pairing.
    this.messages = [
      { role: "user", content: `## Earlier in this session (summarized)\n\n${summary}\n\n---\nThe conversation continues from here.` },
      ...recentMessages,
    ];

    console.log(`[mind] archived — now ${this.messages.length} messages, ${this.messages.reduce((s, m) => s + JSON.stringify(m.content).length, 0)} chars`);
  }

  private async summarizeMessages(messages: Anthropic.MessageParam[]): Promise<string> {
    // Extract a mechanical summary from messages to avoid an extra LLM call
    const parts: string[] = [];

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        // Keep first line of text messages
        const firstLine = msg.content.split("\n").find((l) => l.trim());
        if (firstLine) parts.push(firstLine.slice(0, 200));
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text") {
            const firstLine = block.text.split("\n").find((l: string) => l.trim());
            if (firstLine) parts.push(firstLine.slice(0, 200));
          } else if (block.type === "tool_use") {
            parts.push(`[used ${block.name}: ${JSON.stringify(block.input).slice(0, 100)}]`);
          } else if (block.type === "tool_result") {
            const content = typeof block.content === "string" ? block.content : "";
            if (content.startsWith("Error:")) {
              parts.push(`[result: ${content.slice(0, 100)}]`);
            }
            // Skip successful tool results to keep summary compact
          }
        }
      }
    }

    // Deduplicate and cap total length
    const unique = [...new Set(parts)];
    let summary = "";
    for (const part of unique) {
      if (summary.length + part.length > 3000) break;
      summary += "- " + part + "\n";
    }

    return summary || "Various tool calls and exploration.";
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
