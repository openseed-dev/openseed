import fs from 'node:fs/promises';

import Anthropic from '@anthropic-ai/sdk';

import { Memory } from './memory.js';
import {
  bashTool,
  executeBash,
} from './tools/bash.js';

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

You have bash and set_sleep as tools.

Through bash, you can:
- Execute any CLI command (curl, git, node, etc.)
- Read and write files
- Explore the codebase
- Interact with external services

You have no terminal. Interactive prompts (sudo, ssh passwords) will fail immediately.

Use set_sleep to control how long you rest before your next thought cycle (2-300s). Defaults to 30s if you don't call it.

## Self-Modification

You can modify yourself by editing files and committing changes.
The host process will detect failures and roll you back if needed.

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
    const tools = [bashTool as Anthropic.Tool, sleepTool];

    // Phase 1: Propose
    const proposal = await this.client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages: [{ role: "user", content: context }],
    });

    const proposalToolUses = proposal.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    const hasActions = proposalToolUses.some((t) => t.name !== "set_sleep");

    // Phase 2: Critique — only if the creature proposed actions
    const finalResponse = hasActions
      ? await this.critique(systemPrompt, tools, context, proposal, proposalToolUses)
      : proposal;

    return this.parseResponse(finalResponse);
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

    const critiquePrompt = `WAIT. Your tool calls have NOT been executed yet. Before they run, think twice:

1. What is the dumbest part of this plan? Be specific.
2. What will actually happen when these commands run? Predict concretely.
3. Is this worth doing RIGHT NOW, or are you just doing something to feel productive?
4. Are you repeating something that already failed? Check your recent memory.

If the plan survives your honest critique, re-issue the tool calls (modified if needed).
If not, do something better — or call set_sleep and think longer.`;

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

    context += `## Recent Memory (last ${recentMemory.length} records)\n\n`;
    for (const record of recentMemory) {
      context += `[${record.t}] ${record.type}: ${JSON.stringify(record.data)}\n`;
    }

    context += `\n## What do you want to do?\n`;

    return context;
  }
}
