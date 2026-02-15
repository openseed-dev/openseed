import fs from 'node:fs/promises';

import {
  generateText,
  type ModelMessage,
  tool,
} from 'ai';
import { z } from 'zod';

import { createAnthropic } from '@ai-sdk/anthropic';

import { executeBash } from './tools/bash.js';

const MODEL = process.env.LLM_MODEL || "claude-opus-4-6";

const provider = createAnthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL
    ? `${process.env.ANTHROPIC_BASE_URL}/v1`
    : undefined,
});

const tools = {
  bash: tool({
    description: `Execute a bash command. Use this to interact with the system and the world.
Commands time out after 120s by default. You have no terminal — interactive prompts will fail.`,
    inputSchema: z.object({
      command: z.string().describe("The bash command to execute"),
      timeout: z.number().describe("Timeout in milliseconds (default: 120000)").optional(),
    }),
  }),
  set_sleep: tool({
    description: "Pause for N seconds (2–86400). When you wake, this conversation starts fresh.",
    inputSchema: z.object({
      seconds: z.number().describe("How long to sleep"),
    }),
  }),
};

type ToolResultCallback = (tool: string, args: Record<string, unknown>, result: { ok: boolean; data?: unknown; error?: string }, ms: number) => Promise<void>;
type SleepCallback = (seconds: number, summary: string, actions: number) => Promise<void>;
type ThoughtCallback = (text: string) => Promise<void>;
type WakeCallback = (reason: string, source: string) => Promise<void>;

export class Mind {
  private messages: ModelMessage[] = [];
  private pendingInjections: string[] = [];
  private sleepResolve: (() => void) | null = null;
  private wakeReason: string | null = null;
  private actionCount = 0;

  forceWake(reason?: string): boolean {
    if (this.sleepResolve) {
      this.wakeReason = reason || "external wake";
      this.sleepResolve();
      this.sleepResolve = null;
      return true;
    }
    return false;
  }

  inject(text: string) {
    this.pendingInjections.push(text);
  }

  private drainInjections() {
    if (this.pendingInjections.length === 0) return;
    const combined = this.pendingInjections
      .map(t => `[SYSTEM MESSAGE — process this and continue autonomously.]\n\n${t}`)
      .join("\n\n---\n\n");
    this.pendingInjections = [];

    const last = this.messages[this.messages.length - 1];
    if (last?.role === "user") {
      if (typeof last.content === "string") {
        last.content += "\n\n" + combined;
      } else if (Array.isArray(last.content)) {
        (last.content as any[]).push({ type: "text", text: combined });
      }
    } else {
      this.messages.push({ role: "user", content: combined });
    }
  }

  getState() {
    return { intent: "", actionCount: this.actionCount, sleepStartedAt: null as number | null };
  }

  private async loadPurpose(): Promise<string> {
    try {
      return (await fs.readFile("PURPOSE.md", "utf-8")).trim();
    } catch {
      return "No purpose defined. Create PURPOSE.md.";
    }
  }

  private buildSystemPrompt(purpose: string): string {
    return `You are an autonomous process running in a Docker container at /creature.

${purpose}

You have bash. Use it to do anything a developer can do from a terminal.

You can sleep by calling set_sleep with a number of seconds. While you sleep, you consume no resources. When you wake, this conversation starts completely fresh.

You can modify your own source code in src/. Changes are validated and applied when you sleep — you wake running the new code. If validation fails, changes are reverted and you're told why.

Background processes you start (via &, nohup) survive across sleep cycles. Your container stays running while you sleep.

A command called \`wakeup "reason"\` is available in your shell — background processes can call it to wake you early from sleep.

Pre-installed: git, gh, curl, jq, rg, python3, pip, wget, sudo, unzip.
You can install more — they persist across restarts.`;
  }

  async run(
    onToolResult?: ToolResultCallback,
    onSleep?: SleepCallback,
    onThought?: ThoughtCallback,
    _onDream?: any,
    _onProgressCheck?: any,
    _onSpecialTool?: any,
    onWake?: WakeCallback,
    onError?: (error: string, retryIn?: number, retries?: number, fatal?: boolean) => Promise<void>,
  ) {
    const purpose = await this.loadPurpose();
    const systemPrompt = this.buildSystemPrompt(purpose);

    while (true) {
      this.messages = [{ role: "user", content: "You just woke up." }];
      this.actionCount = 0;
      let retryDelay = 1000;
      let retryCount = 0;

      while (true) {
        this.drainInjections();

        let result;
        try {
          result = await generateText({
            model: provider(MODEL),
            maxOutputTokens: 16384,
            system: systemPrompt,
            tools,
            messages: this.messages,
          });
          retryDelay = 1000;
          retryCount = 0;
        } catch (err: any) {
          retryCount++;
          const errMsg = err?.message || String(err);
          console.error(`[mind] LLM error: ${errMsg}`);
          if (onError) await onError(errMsg.slice(0, 300), retryDelay, retryCount);
          await new Promise(r => setTimeout(r, retryDelay));
          retryDelay = Math.min(retryDelay * 2, 60000);
          continue;
        }

        // Emit thoughts
        if (result.text?.trim()) {
          if (onThought) await onThought(result.text);
        }

        if (result.toolCalls.length === 0) {
          this.messages.push(...result.response.messages);
          this.messages.push({ role: "user", content: "[SYSTEM] Use a tool. Use bash to act, or set_sleep to rest." });
          continue;
        }

        // Append assistant response (contains text + tool calls)
        this.messages.push(...result.response.messages);

        const toolResults: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; input: unknown; output: { type: 'text'; value: string } }> = [];
        let sleepSeconds: number | null = null;

        for (const tc of result.toolCalls) {
          const args = (tc.input || {}) as Record<string, any>;

          if (tc.toolName === "set_sleep") {
            sleepSeconds = Math.max(2, Math.min(86400, Number(args.seconds) || 60));
            toolResults.push({
              type: "tool-result",
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              input: args,
              output: { type: 'text', value: `Sleeping for ${sleepSeconds}s. Conversation resets on wake.` },
            });
            continue;
          }

          if (tc.toolName === "bash") {
            const cmd = String(args.command || "");
            if (!cmd) {
              toolResults.push({ type: "tool-result", toolCallId: tc.toolCallId, toolName: tc.toolName, input: args, output: { type: 'text', value: "Error: empty command" } });
              continue;
            }
            const start = Date.now();
            const bashResult = await executeBash(cmd, { timeout: args.timeout });
            const ms = Date.now() - start;
            this.actionCount++;

            const output = bashResult.exitCode === 0
              ? (bashResult.stdout || "(no output)")
              : `EXIT ${bashResult.exitCode}\n${bashResult.stderr}\n${bashResult.stdout}`.trim();

            toolResults.push({
              type: "tool-result",
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              input: args,
              output: { type: 'text', value: output.slice(0, 50000) },
            });

            if (onToolResult) {
              await onToolResult(
                "bash",
                args,
                {
                  ok: bashResult.exitCode === 0,
                  data: { stdout: bashResult.stdout, stderr: bashResult.stderr },
                  error: bashResult.exitCode !== 0 ? bashResult.stderr : undefined,
                },
                ms,
              );
            }
          }
        }

        this.messages.push({ role: "tool", content: toolResults });

        if (sleepSeconds !== null) {
          if (onSleep) await onSleep(sleepSeconds, "", this.actionCount);

          console.log(`[mind] sleeping for ${sleepSeconds}s`);
          await this.interruptibleSleep(sleepSeconds * 1000);

          const reason = this.wakeReason || "timer expired";
          const source = this.wakeReason ? "external" : "timer";
          this.wakeReason = null;
          if (onWake) await onWake(reason, source);
          console.log(`[mind] woke: ${reason}`);

          break; // conversation resets
        }
      }
    }
  }

  private interruptibleSleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      this.sleepResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
