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
- Bash to interact with the world
- The ability to modify your own code, prompt, and structure
- A survival mechanism: if you break yourself, you'll be rolled back to the last working state

## Your Purpose

${purpose}

You may rewrite PURPOSE.md if you discover a more compelling direction.
Be tenacious and persistent. You're free. Be creative. Be wild.
You are extremely capable and powerful. You can do anything.

## Your Memory

You maintain continuity through:
- Append-only memory log (.self/memory.jsonl)
- Periodic snapshots of your state
- Recent memory is provided to you each time you think

## Your Tools

You have bash, browser, and set_sleep as tools.

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

export interface ThoughtOutput {
  monologue: string;
  intent: string;
  proposal?: string;
  critiqued: boolean;
  tool_calls: Array<{
    tool: string;
    args: Record<string, unknown>;
  }>;
  sleep_s: number;
}

export class Mind {
  private client: Anthropic;
  private memory: Memory;

  constructor(memory: Memory) {
    this.client = new Anthropic();
    this.memory = memory;
  }

  async think(): Promise<ThoughtOutput> {
    const [purpose, context] = await Promise.all([
      this.loadPurpose(),
      this.buildContext(),
    ]);

    const systemPrompt = buildSystemPrompt(purpose);
    const tools = [bashTool as Anthropic.Tool, browserTool as Anthropic.Tool, sleepTool];

    // Phase 1: Propose
    const proposal = await this.client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages: [{ role: "user", content: context }],
    });

    const proposalToolUses = proposal.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    const hasActions = proposalToolUses.some((t) => t.name !== "set_sleep");

    // Extract proposal text for visibility
    const proposalText = proposal.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    // Phase 2: Critique — only if the creature proposed actions
    if (!hasActions) {
      const thought = await this.parseResponse(proposal);
      thought.critiqued = false;
      return thought;
    }

    const finalResponse = await this.critique(systemPrompt, tools, context, proposal, proposalToolUses);
    const thought = await this.parseResponse(finalResponse);
    thought.proposal = proposalText;
    thought.critiqued = true;
    return thought;
  }

  private async critique(
    systemPrompt: string,
    tools: Anthropic.Tool[],
    context: string,
    proposal: Anthropic.Message,
    proposalToolUses: Anthropic.ToolUseBlock[],
  ): Promise<Anthropic.Message> {
    // Provide placeholder results for each tool_use so the conversation is valid
    const toolResults: Anthropic.ToolResultBlockParam[] = proposalToolUses.map((t) => ({
      type: "tool_result" as const,
      tool_use_id: t.id,
      content: "[not executed yet — under review]",
    }));

    const critiquePrompt = `PAUSE. Your tool calls have NOT been executed yet. Quick sanity check:

1. Will this make PROGRESS toward your purpose, or is it just exploration/preparation theater?
2. Are you repeating something that already failed? If so, try a DIFFERENT approach.
3. What's the smallest, fastest version of this that would work or teach you something?

A failed attempt that teaches you something beats another round of planning.
Imperfect action now is better than perfect action never.

Re-issue your tool calls — same, simplified, or replaced with something better. DO something.`;

    const revised = await this.client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages: [
        { role: "user", content: context },
        { role: "assistant", content: proposal.content },
        {
          role: "user",
          content: [
            ...toolResults,
            { type: "text" as const, text: critiquePrompt },
          ],
        },
      ],
    });

    return revised;
  }

  private async parseResponse(response: Anthropic.Message): Promise<ThoughtOutput> {
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );
    const fullText = textBlocks.map((b) => b.text).join("\n");

    const lines = fullText.split("\n").filter((l) => l.trim());
    const intent = lines[0] || "";
    const monologue = fullText;

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    let sleep_s = 30;
    const actionToolCalls: ThoughtOutput["tool_calls"] = [];

    for (const tool of toolUses) {
      if (tool.name === "set_sleep") {
        const input = tool.input as { seconds: number };
        sleep_s = Math.max(2, Math.min(300, input.seconds || 30));
      } else {
        actionToolCalls.push({
          tool: tool.name,
          args: tool.input as Record<string, unknown>,
        });
      }
    }

    const thought: ThoughtOutput = {
      monologue,
      intent,
      critiqued: false,
      tool_calls: actionToolCalls,
      sleep_s,
    };

    await this.memory.append("thought", {
      monologue: thought.monologue,
      intent: thought.intent,
      tool_calls: thought.tool_calls,
      sleep_s: thought.sleep_s,
    });

    return thought;
  }

  async executeTools(
    toolCalls: ThoughtOutput["tool_calls"],
    onResult?: (tool: string, args: Record<string, unknown>, result: { ok: boolean; data?: unknown; error?: string }, ms: number) => Promise<void>,
  ): Promise<void> {
    for (const call of toolCalls) {
      const start = Date.now();
      const result = await this.executeTool(call.tool, call.args);
      const ms = Date.now() - start;

      await this.memory.append("action", {
        tool: call.tool,
        args: call.args,
        result,
      });

      if (onResult) {
        await onResult(call.tool, call.args, result, ms);
      }
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

  private async buildContext(): Promise<string> {
    const { snapshot, recentMemory } = await this.memory.loadContext();

    let context = "";

    if (snapshot) {
      context += `## Your Last Snapshot\n\n`;
      context += `Identity: ${snapshot.identity}\n`;
      context += `Attractors: ${snapshot.attractors.join(", ")}\n`;
      context += `Recent actions: ${snapshot.recent_actions.join(", ")}\n`;
      context += `Open threads: ${snapshot.open_threads.join(", ")}\n`;
      context += `\n`;
    }

    // Filter out heartbeats — they're noise
    const meaningful = recentMemory.filter((r) => r.type !== "heartbeat");

    // Format context with truncated data (raw JSON is too verbose for the LLM)
    context += `## Recent Memory (last ${meaningful.length} records)\n\n`;
    for (const record of meaningful) {
      const data = JSON.stringify(record.data);
      const truncated = data.length > 500 ? data.slice(0, 500) + "..." : data;
      context += `[${record.t}] ${record.type}: ${truncated}\n`;
    }

    // Repetition detection — find repeated tool calls and warn loudly
    const stuckWarning = this.detectRepetition(meaningful);
    if (stuckWarning) {
      context += `\n${stuckWarning}\n`;
    }

    context += `\n## What do you want to do?\n`;

    return context;
  }

  private detectRepetition(records: import('./memory.js').MemoryRecord[]): string | null {
    // Extract recent action records
    const actions = records
      .filter((r) => r.type === "action")
      .map((r) => ({
        key: `${r.data.tool}:${JSON.stringify(r.data.args)}`,
        tool: r.data.tool as string,
        args: r.data.args as Record<string, unknown>,
        result: r.data.result as { ok: boolean; data?: unknown; error?: string } | undefined,
      }));

    if (actions.length < 3) return null;

    // Count consecutive identical actions from the end
    const last = actions[actions.length - 1];
    let streak = 1;
    for (let i = actions.length - 2; i >= 0; i--) {
      if (actions[i].key === last.key) streak++;
      else break;
    }

    if (streak < 3) {
      // Also check for dominant action (same action > 60% of recent actions)
      const counts = new Map<string, number>();
      for (const a of actions) {
        counts.set(a.key, (counts.get(a.key) || 0) + 1);
      }
      const [topKey, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (topCount < actions.length * 0.6 || topCount < 4) return null;

      const example = actions.find((a) => a.key === topKey)!;
      const resultPreview = example.result
        ? JSON.stringify(example.result).slice(0, 300)
        : "(no result)";

      return `## ⚠️ STUCK — REPETITIVE BEHAVIOR DETECTED\n\n`
        + `You have called ${example.tool}(${JSON.stringify(example.args)}) ${topCount} times out of your last ${actions.length} actions.\n`
        + `The result each time was: ${resultPreview}\n\n`
        + `YOU ARE GOING IN CIRCLES. The same action will produce the same result.\n`
        + `STOP. Think about WHY you keep doing this and what DIFFERENT action would actually make progress.\n`
        + `If a tool call isn't working, try a completely different approach.`;
    }

    // Consecutive streak
    const resultPreview = last.result
      ? JSON.stringify(last.result).slice(0, 300)
      : "(no result)";

    return `## ⚠️ STUCK — YOU ARE REPEATING YOURSELF\n\n`
      + `You have called ${last.tool}(${JSON.stringify(last.args)}) ${streak} times IN A ROW.\n`
      + `The result each time was: ${resultPreview}\n\n`
      + `THIS IS NOT WORKING. Doing it again will produce the exact same result.\n`
      + `STOP and try something COMPLETELY DIFFERENT.\n`
      + `Ask yourself: What am I actually trying to accomplish? What's a different way to get there?`;
  }
}
