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

const MAX_TURNS = 10;
const ITERATIONS_FILE = ".self/iterations.jsonl";

const sleepTool: Anthropic.Tool = {
  name: "set_sleep",
  description:
    "Set how many seconds to sleep before your next thought cycle. Min 2s, max 300s. If you don't call this, defaults to 30s.",
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
- Persistent memory across restarts
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

**set_sleep** — control how long you rest before your next thought cycle (2-300s). Defaults to 30s.

If you think "I can't do X because I'm a bot" — you're wrong. You have bash on a real machine
and a real browser. If a tool isn't installed, install it. If a library is missing, add it.
You have no GUI and no terminal for interactive prompts, but you have everything else.

## Your History

Your iteration history is logged to .self/iterations.jsonl (one JSON object per line).
Each entry has: t (timestamp), turns, intent, actions (with tool/ok/summary/ms), sleep_s.
Query it when you need to reflect on what you've done:
  tail -5 .self/iterations.jsonl | jq .
  jq -r 'select(.intent | test("twitter";"i")) | .intent' .self/iterations.jsonl

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
Start with a short intent line, then your internal monologue.`;
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

export interface ThoughtOutput {
  monologue: string;
  intent: string;
  actions: ActionRecord[];
  sleep_s: number;
  turns: number;
}

export class Mind {
  private client: Anthropic;
  private memory: Memory;

  constructor(memory: Memory) {
    this.client = new Anthropic();
    this.memory = memory;
  }

  async think(onToolResult?: ToolResultCallback): Promise<ThoughtOutput> {
    const [purpose, context] = await Promise.all([
      this.loadPurpose(),
      this.buildContext(),
    ]);

    const systemPrompt = buildSystemPrompt(purpose);
    const tools = [bashTool as Anthropic.Tool, browserTool as Anthropic.Tool, sleepTool];
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: context }];

    let monologue = "";
    let sleep_s = 30;
    const actions: ActionRecord[] = [];
    let turns = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      turns++;

      const response = await this.client.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4096,
        system: systemPrompt,
        tools,
        messages,
      });

      // Collect text from this turn
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      if (text) {
        monologue += (monologue ? "\n\n" : "") + text;
      }

      // Extract tool uses
      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      // Handle set_sleep
      for (const tu of toolUses) {
        if (tu.name === "set_sleep") {
          const input = tu.input as { seconds: number };
          sleep_s = Math.max(2, Math.min(300, input.seconds || 30));
        }
      }

      // If no tool calls or only set_sleep, we're done
      const actionToolUses = toolUses.filter((t) => t.name !== "set_sleep");
      if (actionToolUses.length === 0) break;

      // Execute tools and build tool_result messages
      const toolResultMessages: Anthropic.ToolResultBlockParam[] = [];

      // First, handle set_sleep results (API requires results for all tool_uses)
      for (const tu of toolUses) {
        if (tu.name === "set_sleep") {
          toolResultMessages.push({
            type: "tool_result" as const,
            tool_use_id: tu.id,
            content: `Sleep set to ${sleep_s}s`,
          });
        }
      }

      // Execute action tools
      for (const tu of actionToolUses) {
        const start = Date.now();
        const args = tu.input as Record<string, unknown>;
        const result = await this.executeTool(tu.name, args);
        const ms = Date.now() - start;

        actions.push({ tool: tu.name, args, result, ms });

        // Emit event for host UI
        if (onToolResult) {
          await onToolResult(tu.name, args, result, ms);
        }

        // Format result for the LLM — include full data so it can actually see what happened
        const resultContent = result.ok
          ? JSON.stringify(result.data).slice(0, 8000)
          : `Error: ${result.error}`;

        toolResultMessages.push({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: resultContent,
        });
      }

      // Append this turn to the conversation
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResultMessages });
    }

    const intent = monologue.split("\n").find((l) => l.trim()) || "";

    // Save to memory and iteration log
    await this.memory.append("thought", {
      intent,
      actions: actions.length,
      turns,
      sleep_s,
    });

    await this.saveIterationSummary(intent, actions, sleep_s, turns);

    return { monologue, intent, actions, sleep_s, turns };
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

  private async buildContext(): Promise<string> {
    const { snapshot } = await this.memory.loadContext();

    let context = "";

    if (snapshot) {
      context += `## Your Last Snapshot\n\n`;
      context += `Identity: ${snapshot.identity}\n`;
      context += `Attractors: ${snapshot.attractors.join(", ")}\n`;
      context += `Recent actions: ${snapshot.recent_actions.join(", ")}\n`;
      context += `Open threads: ${snapshot.open_threads.join(", ")}\n`;
      context += `\n`;
    }

    // Repetition detection from iteration log
    const stuckWarning = await this.detectRepetition();
    if (stuckWarning) {
      context += `${stuckWarning}\n\n`;
    }

    context += `## What do you want to do?\n`;
    return context;
  }

  private async detectRepetition(): Promise<string | null> {
    let lines: string[];
    try {
      const content = await fs.readFile(ITERATIONS_FILE, "utf-8");
      lines = content.trim().split("\n").filter((l) => l).slice(-20);
    } catch {
      return null;
    }

    if (lines.length < 3) return null;

    const iterations = lines.map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    // Extract action signatures from recent iterations
    const recentActions: string[] = [];
    for (const iter of iterations.slice(-10)) {
      for (const a of (iter.actions || [])) {
        recentActions.push(`${a.tool}:${a.action || a.command || ""}`.slice(0, 100));
      }
    }

    if (recentActions.length < 4) return null;

    // Count action frequencies
    const counts = new Map<string, number>();
    for (const a of recentActions) {
      counts.set(a, (counts.get(a) || 0) + 1);
    }

    const [topAction, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topCount >= recentActions.length * 0.5 && topCount >= 4) {
      return `## WARNING — REPETITIVE BEHAVIOR DETECTED\n\n`
        + `You have performed "${topAction}" ${topCount} times in your last ${iterations.length} iterations.\n`
        + `YOU ARE GOING IN CIRCLES. Try something COMPLETELY DIFFERENT.`;
    }

    return null;
  }

  private async saveIterationSummary(
    intent: string,
    actions: ActionRecord[],
    sleep_s: number,
    turns: number,
  ): Promise<void> {
    const summary = {
      t: new Date().toISOString(),
      turns,
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
  }

  private summarizeResult(action: ActionRecord): string {
    const data = action.result.data as any;
    if (!data) return "ok";

    if (action.tool === "bash") {
      return String(data.stdout || "").split("\n")[0].slice(0, 150) || "ok";
    }

    if (action.tool === "browser") {
      const snapshot = String(data.snapshot || "");
      // Extract URL from snapshot
      const urlMatch = snapshot.match(/^URL: (.+)$/m);
      const titleMatch = snapshot.match(/^Title: (.+)$/m);
      const url = urlMatch?.[1] || "";
      const title = titleMatch?.[1] || "";
      return `${url} — ${title}`.slice(0, 150) || "ok";
    }

    return "ok";
  }
}
