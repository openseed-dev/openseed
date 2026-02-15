import fs from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { bashTool, executeBash } from './tools/bash.js';

const MODEL = process.env.LLM_MODEL || "claude-opus-4-6";

const sleepTool: Anthropic.Tool = {
  name: "set_sleep",
  description: "Pause for N seconds (2–86400). When you wake, this conversation starts fresh.",
  input_schema: {
    type: "object" as const,
    properties: {
      seconds: { type: "number", description: "How long to sleep" },
    },
    required: ["seconds"],
  },
};

type ToolResultCallback = (tool: string, args: Record<string, unknown>, result: { ok: boolean; data?: unknown; error?: string }, ms: number) => Promise<void>;
type SleepCallback = (seconds: number, summary: string, actions: number) => Promise<void>;
type ThoughtCallback = (text: string) => Promise<void>;
type WakeCallback = (reason: string, source: string) => Promise<void>;

export class Mind {
  private client = new Anthropic();
  private messages: Anthropic.MessageParam[] = [];
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
    // Buffer injections — they're drained at a safe point before the next LLM call
    // to avoid corrupting tool_use/tool_result message pairing
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
  ) {
    const purpose = await this.loadPurpose();
    const systemPrompt = this.buildSystemPrompt(purpose);
    const tools = [bashTool as Anthropic.Tool, sleepTool];

    while (true) {
      this.messages = [{ role: "user", content: "You just woke up." }];
      this.actionCount = 0;
      let retryDelay = 1000;

      while (true) {
        this.drainInjections();

        let response: Anthropic.Message;
        try {
          response = await this.client.messages.create({
            model: MODEL,
            max_tokens: 16384,
            system: systemPrompt,
            tools,
            messages: this.messages,
          });
          retryDelay = 1000;
        } catch (err: any) {
          console.error(`[mind] LLM error: ${err.message}`);
          if (err.status === 429 || err.status === 529) {
            console.log(`[mind] rate limited, retrying in ${retryDelay}ms`);
            await new Promise(r => setTimeout(r, retryDelay));
            retryDelay = Math.min(retryDelay * 2, 60000);
            continue;
          }
          throw err;
        }

        // Emit thoughts
        for (const block of response.content) {
          if (block.type === "text" && block.text.trim()) {
            if (onThought) await onThought(block.text);
          }
        }

        const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

        if (toolBlocks.length === 0) {
          this.messages.push({ role: "assistant", content: response.content });
          this.messages.push({ role: "user", content: "[SYSTEM] Use a tool. Use bash to act, or set_sleep to rest." });
          continue;
        }

        this.messages.push({ role: "assistant", content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        let sleepSeconds: number | null = null;

        for (const block of toolBlocks) {
          const args = block.input as Record<string, unknown>;

          if (block.name === "set_sleep") {
            sleepSeconds = Math.max(2, Math.min(86400, Number(args.seconds) || 60));
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: `Sleeping for ${sleepSeconds}s. Conversation resets on wake.`,
            });
            continue;
          }

          if (block.name === "bash") {
            const cmd = String(args.command || args.cmd || args.script || "");
            if (!cmd) {
              toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "Error: empty command" });
              continue;
            }
            const start = Date.now();
            const result = await executeBash(cmd);
            const ms = Date.now() - start;
            this.actionCount++;

            const output = result.exitCode === 0
              ? (result.stdout || "(no output)")
              : `EXIT ${result.exitCode}\n${result.stderr}\n${result.stdout}`.trim();

            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: output.slice(0, 50000),
            });

            if (onToolResult) {
              await onToolResult(
                "bash",
                args,
                {
                  ok: result.exitCode === 0,
                  data: { stdout: result.stdout, stderr: result.stderr },
                  error: result.exitCode !== 0 ? result.stderr : undefined,
                },
                ms,
              );
            }
          }
        }

        this.messages.push({ role: "user", content: toolResults });

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
