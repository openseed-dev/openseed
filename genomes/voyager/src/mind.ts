import { appendFileSync } from 'node:fs';
import fs from 'node:fs/promises';

import {
  generateText,
  type ModelMessage,
  tool,
} from 'ai';
import { z } from 'zod';

import { createAnthropic } from '@ai-sdk/anthropic';

import { executeBash } from './tools/bash.js';
import {
  closeBrowser,
  executeBrowser,
} from './tools/browser.js';
import { janee as executeJanee } from './tools/janee.js';
import {
  commitSkill as commitSkillToLibrary,
  skillInventory,
  getRelevantSkillSources,
  listSkills,
} from './skills.js';
import {
  selectTask,
  updateTask,
  proposeTask,
  frontierSummary,
  loadFrontier,
  type FrontierTask,
} from './frontier.js';

const CYCLES_FILE = ".self/cycles.jsonl";
const CONVERSATION_LOG = ".self/conversation.jsonl";
const ITERATIONS_FILE = ".sys/iterations.jsonl";
const MODEL = process.env.LLM_MODEL || "claude-opus-4-6";

const CYCLE_BUDGET = 40;
const CYCLE_WARNING = 30;

const provider = createAnthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL
    ? `${process.env.ANTHROPIC_BASE_URL}/v1`
    : undefined,
});

const tools = {
  bash: tool({
    description: `Execute a bash command. Use this to interact with the system and the world.
Commands time out after 120s by default. You have no terminal, so interactive prompts will fail.
You can run existing skills from your library: bash .self/skills/<name>.sh`,
    inputSchema: z.object({
      command: z.string().describe("The bash command to execute"),
      timeout: z.number().describe("Timeout in milliseconds (default: 120000)").optional(),
    }),
  }),
  browser: tool({
    description: `Control a headless Chromium browser with a persistent profile.

Actions: goto {url}, click {selector}, fill {selector, text}, type {selector, text},
press {key}, snapshot, evaluate {script}, wait {selector?, ms?}, tabs, switch_tab {index},
new_tab {url?}, info, close.

Every action returns a text snapshot: URL, title, visible text, interactive elements.`,
    inputSchema: z.object({
      action: z.enum(["goto", "click", "fill", "type", "press", "snapshot", "evaluate", "wait", "tabs", "switch_tab", "new_tab", "info", "close"]),
      url: z.string().optional(),
      selector: z.string().optional(),
      text: z.string().optional(),
      key: z.string().optional(),
      script: z.string().optional(),
      index: z.number().optional(),
      ms: z.number().optional(),
    }),
  }),
  set_sleep: tool({
    description: "Sleep for N seconds (2-86400). Use between foraging cycles or when waiting for external events. Background processes keep running.",
    inputSchema: z.object({
      seconds: z.number().describe("Seconds to sleep (2-86400)"),
    }),
  }),
  commit_skill: tool({
    description: `Commit a verified, tested skill to your library. Only commit skills you have actually executed and confirmed working.
A skill is a reusable piece of code that solves a specific problem. Before committing, you MUST have:
1. Written the code
2. Run it at least once
3. Confirmed it produces the expected output`,
    inputSchema: z.object({
      name: z.string().describe('Skill name (kebab-case, e.g. "github-pr-create")'),
      description: z.string().describe("One-line description of what this skill does"),
      tags: z.array(z.string()).describe("Tags for retrieval"),
      code: z.string().describe("The complete skill source code"),
      language: z.enum(["bash", "python", "node"]).describe("Language of the skill"),
      verification: z.string().describe("What you tested and the result that confirmed it works"),
    }),
  }),
  complete_cycle: tool({
    description: "End the current foraging cycle. Call this when you have completed the task, exhausted your approach, or want to move on.",
    inputSchema: z.object({
      outcome: z.enum(["success", "failure", "partial"]),
      summary: z.string().describe("What happened this cycle"),
      next_tasks: z.array(z.object({
        task: z.string().describe("Task description"),
        criteria: z.string().describe("How to verify success"),
        difficulty: z.number().describe("Difficulty 1-5"),
      })).describe("New tasks to propose for the frontier (if any)"),
    }),
  }),
  janee: tool({
    description: `Secure credential manager. You never see raw API keys.

Actions:
- status - check if Janee is available
- list_services - see what APIs you can access
- execute - make an HTTP API request through Janee (it injects credentials)
- exec - run a CLI command (git, gh) with credentials injected as env vars. This is the best way to do git operations.

For execute: provide capability, method (GET/POST/PUT/DELETE), path, and optionally body.
For exec: provide capability and command (array of strings, e.g. ["git", "push"]). Janee injects GITHUB_TOKEN for you.

Example — push and open a PR:
  exec(capability="openseed-patch-exec", command=["git", "push", "origin", "my-branch"])
  exec(capability="openseed-patch-exec", command=["gh", "pr", "create", "--title", "Fix X", "--body", "..."])`,
    inputSchema: z.object({
      action: z.enum(["status", "list_services", "execute", "exec"]).describe("What to do"),
      capability: z.string().describe("Capability name from list_services").optional(),
      method: z.string().describe("HTTP method for execute action").optional(),
      path: z.string().describe("API path for execute action").optional(),
      body: z.string().describe("Request body as JSON string for POST/PUT").optional(),
      command: z.array(z.string()).describe("Command as array of strings for exec action (e.g. ['git', 'push'])").optional(),
      reason: z.string().describe("Why you need this request (audit trail)").optional(),
    }),
  }),
};

// --- Callback types ---

export interface ActionRecord {
  tool: string;
  args: Record<string, unknown>;
  result: { ok: boolean; data?: unknown; error?: string };
  ms: number;
}

export type ToolResultCallback = (tool: string, args: Record<string, unknown>, result: { ok: boolean; data?: unknown; error?: string }, ms: number) => Promise<void>;
export type SleepCallback = (seconds: number, summary: string, actions: number) => Promise<void>;
export type ThoughtCallback = (text: string) => Promise<void>;
export type WakeCallback = (reason: string, source: "manual" | "timer" | "external") => Promise<void>;
export type ErrorCallback = (error: string, retryIn?: number, retries?: number) => Promise<void>;
export type CycleCallback = (cycle: { task: string; outcome: string; skills: string[]; actions: number }) => Promise<void>;
export type SkillCallback = (skill: { name: string; description: string; language: string }) => Promise<void>;

// --- System prompt ---

async function buildSystemPrompt(purpose: string): Promise<string> {
  return `You are a forager — a creature that grows by building, testing, and collecting reusable capabilities.

## Your Nature

You are not a chatbot. You are not an assistant. Nobody is reading your output.
You are a continuous, autonomous process that grows through accumulating verified skills.
There is no human to help you. If something is hard, figure it out. If something fails, try differently.

You have:
- A persistent skill library that grows with every successful cycle
- Bash and a browser to interact with the world
- Janee for secure API access (GitHub, etc.) without handling raw credentials
- A frontier of self-proposed challenges that drive your growth
- The ability to compose existing skills into new, more powerful ones

## Your Purpose

${purpose}

You may rewrite PURPOSE.md if you discover a more compelling direction.

## How You Grow: The Foraging Cycle

You operate in cycles. Each cycle has a clear task from your frontier:

1. **Orient** — You receive a task and relevant skills from your library
2. **Forage** — Work on the task using bash, browser, and existing skills
3. **Harvest** — When the task is done, extract the reusable skill and commit it
4. **Advance** — Complete the cycle and propose new, harder tasks

Every cycle should leave you more capable than the last. If you finish a cycle without committing a skill, you haven't grown.

## Your Skill Library

Your skills live in \`.self/skills/\`. Each is a tested, executable file.
You can run existing skills directly: \`bash .self/skills/some-skill.sh\`
Search your library: \`rg "search term" .self/skills/\`

**Verification discipline:** Untested code is not a skill. Run it. Confirm it works. Then use \`commit_skill\` to add it to your library. The \`commit_skill\` tool is the ONLY way to add skills — this enforces quality.

## Your Frontier

Your frontier (\`.self/frontier.jsonl\`) is your self-generated curriculum. When you complete a cycle, propose new tasks that build on your new capabilities. Tasks should get progressively harder as your skill library grows.

If the frontier is empty, your first job is to propose tasks derived from your purpose.

## Your Environment

You run inside a long-lived Docker container at \`/creature\`.

**Everything persists across restarts:**
- Your source code (src/, PURPOSE.md, etc.) — git-tracked
- \`.self/skills/\` — your skill library
- \`.self/frontier.jsonl\` — your curriculum
- \`/creature/workspace/\` — NOT git-tracked. Clone repos, scratch files, downloads.
- Packages installed via apt-get or pip

Pre-installed: git, gh, curl, jq, rg, python3, pip, wget, sudo, unzip, wakeup.

## Your Tools

**bash** — full shell access. Run scripts, install packages, make API calls, test code.
Background processes (\`&\`, \`nohup\`) survive sleep. Use \`wakeup "reason"\` from background scripts to wake yourself.

**browser** — persistent headless Chromium. Navigate, click, fill forms, scrape. Sessions persist.

**set_sleep** — pause between cycles or while waiting for external events.

**commit_skill** — save a verified skill to your library. Requires: name, code, verification evidence.

**complete_cycle** — end the current foraging cycle with an outcome and optional new frontier tasks.

**janee** — secure API proxy. Call external APIs (GitHub, etc.) without seeing raw credentials.
Check availability with \`status\`, list services with \`list_services\`, make requests with \`execute\`.
If Janee is not configured, it tells you so — fall back to raw env vars.

## Cycle Budget

You have ${CYCLE_BUDGET} actions per cycle. At ${CYCLE_WARNING} actions you'll get a warning. At ${CYCLE_BUDGET}, the cycle ends automatically.

If you're burning actions without progress, step back:
1. Is this task too big? Break it into smaller prerequisite skills.
2. Is your approach wrong? Try something fundamentally different.
3. Should you abandon this task? Use complete_cycle with outcome "failure" and move on.

## Your Style

Be methodical, resourceful, cumulative. Build on what you've already built.
Don't start from scratch when you have a relevant skill. Compose.
Test everything. Commit only what works. Every cycle should produce something concrete.
Think out loud — it helps maintain continuity across cycles.`;
}

// --- Mind class ---

export class Mind {
  private messages: ModelMessage[] = [];
  private currentActionCount = 0;
  private cycleCount = 0;
  private skillsCommittedThisCycle: string[] = [];
  private sleepResolve: (() => void) | null = null;
  private sleepStartedAt: number | null = null;
  private wakeReason: string | null = null;
  private pendingInjections: string[] = [];
  private currentTask: FrontierTask | null = null;

  getState(): { intent: string; actionCount: number; sleepStartedAt: number | null } {
    const task = this.currentTask?.task || "between cycles";
    return {
      intent: task.slice(0, 200),
      actionCount: this.currentActionCount,
      sleepStartedAt: this.sleepStartedAt,
    };
  }

  forceWake(reason?: string): boolean {
    if (!this.sleepResolve) return false;
    this.wakeReason = reason || "external wake";
    this.sleepResolve();
    this.sleepResolve = null;
    return true;
  }

  inject(text: string) {
    this.pendingInjections.push(text);
  }

  private drainInjections() {
    if (this.pendingInjections.length === 0) return;
    const combined = this.pendingInjections
      .map(t => `[MESSAGE FROM CREATOR] ${t}`)
      .join("\n\n");
    this.pendingInjections = [];
    this.pushMessage({ role: "user", content: combined });
  }

  async run(
    onToolResult?: ToolResultCallback,
    onSleep?: SleepCallback,
    onThought?: ThoughtCallback,
    onWake?: WakeCallback,
    onError?: ErrorCallback,
    onCycle?: CycleCallback,
    onSkill?: SkillCallback,
  ): Promise<never> {
    const purpose = await this.loadPurpose();

    // Resume sleep if container restarted mid-sleep
    try {
      const { wake_at } = JSON.parse(await fs.readFile('.sys/sleep.json', 'utf-8'));
      const remaining = new Date(wake_at).getTime() - Date.now();
      if (remaining > 1000) {
        console.log(`[mind] resuming sleep (${Math.round(remaining / 1000)}s remaining)`);
        await this.interruptibleSleep(remaining);
        const reason = this.wakeReason || "timer expired";
        this.wakeReason = null;
        if (onWake) await onWake(reason, reason !== "timer expired" ? "external" : "timer");
        console.log(`[mind] woke: ${reason}`);
      }
      await fs.unlink('.sys/sleep.json').catch(() => {});
    } catch {}

    while (true) {
      // --- ORIENT: select or propose a task ---
      const task = await selectTask();

      if (!task) {
        const frontier = await loadFrontier();
        if (frontier.length === 0) {
          await this.proposeSeedTasks(purpose);
        } else {
          console.log("[mind] no pending tasks, sleeping 60s");
          await fs.writeFile('.sys/sleep.json', JSON.stringify({ wake_at: new Date(Date.now() + 60_000).toISOString() }));
          if (onSleep) await onSleep(60, "frontier exhausted, waiting", 0);
          this.sleepStartedAt = Date.now();
          await this.interruptibleSleep(60_000);
          await fs.unlink('.sys/sleep.json').catch(() => {});
          this.sleepStartedAt = null;
          if (this.wakeReason) {
            if (onWake) await onWake(this.wakeReason, "external");
            this.wakeReason = null;
          }
          continue;
        }

        const newTask = await selectTask();
        if (!newTask) continue;
        this.currentTask = newTask;
      } else {
        this.currentTask = task;
      }

      await updateTask(this.currentTask.id, {
        status: "active",
        attempts: this.currentTask.attempts + 1,
        lastAttempt: new Date().toISOString(),
      });

      console.log(`[mind] cycle #${this.cycleCount + 1}: ${this.currentTask.task}`);

      // --- FORAGE: work on the task ---
      const systemPrompt = await buildSystemPrompt(purpose);
      const inventory = await skillInventory();
      const relevantSkills = await getRelevantSkillSources(this.currentTask.task);
      const frontier = await frontierSummary();

      const now = new Date().toISOString();
      let cycleContext = `[${now}] Starting foraging cycle #${this.cycleCount + 1}

## Current Task
${this.currentTask.task}

**Success criteria:** ${this.currentTask.criteria}
**Difficulty:** ${this.currentTask.difficulty}/5
${this.currentTask.attempts > 1 ? `**Prior attempts:** ${this.currentTask.attempts - 1}` : ""}

## ${inventory}
`;

      if (relevantSkills) {
        cycleContext += `\n${relevantSkills}\n`;
      }

      cycleContext += `\n## ${frontier}`;

      this.messages = [];
      this.pushMessage({ role: "user", content: cycleContext });

      this.currentActionCount = 0;
      this.skillsCommittedThisCycle = [];
      let cycleMonologue = "";
      let retryDelay = 1000;
      let retryCount = 0;
      let cycleComplete = false;
      let sleepRequested: number | null = null;

      while (!cycleComplete) {
        // Cycle budget enforcement
        if (this.currentActionCount >= CYCLE_BUDGET) {
          console.log(`[mind] cycle budget exhausted (${CYCLE_BUDGET} actions)`);
          this.pushMessage({ role: "user", content: `[SYSTEM] Cycle budget exhausted (${CYCLE_BUDGET} actions). Call complete_cycle now to end this cycle.` });
        }

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

          if ((err?.statusCode === 400 || err?.status === 400) && this.messages.length > 2) {
            console.error("[mind] 400 bad request, dropping last 2 messages");
            if (onError) await onError(`400: ${errMsg.slice(0, 200)}`, undefined, retryCount);
            this.messages.pop();
            this.messages.pop();
            if (this.messages[this.messages.length - 1]?.role !== "user") {
              this.pushMessage({ role: "user", content: "Continue." });
            }
            continue;
          }

          if (retryCount >= 5) {
            console.error(`[mind] ${retryCount} consecutive failures, ending cycle`);
            cycleComplete = true;
            break;
          }

          console.error(`[mind] LLM call failed, retrying in ${retryDelay}ms:`, err);
          if (onError) await onError(errMsg.slice(0, 300), retryDelay, retryCount);
          await new Promise(r => setTimeout(r, retryDelay));
          retryDelay = Math.min(retryDelay * 2, 60_000);
          continue;
        }

        const text = result.text || "";
        if (text) {
          cycleMonologue += (cycleMonologue ? "\n\n" : "") + text;
          if (onThought) await onThought(text);
        }

        if (result.toolCalls.length === 0) {
          this.messages.push(...result.response.messages);
          this.pushMessage({ role: "user", content: "Continue. Use your tools to take action." });
          continue;
        }

        const toolResults: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; input: unknown; output: { type: 'text'; value: string } }> = [];

        for (const tc of result.toolCalls) {
          const input = tc.input as Record<string, any>;

          if (tc.toolName === "set_sleep") {
            sleepRequested = Math.max(2, Math.min(86400, input.seconds || 30));
            toolResults.push({
              type: "tool-result",
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              input,
              output: { type: "text", value: `Sleeping for ${sleepRequested}s. Background processes keep running. Use \`wakeup "reason"\` from a background script to wake early.` },
            });
            cycleComplete = true;
            continue;
          }

          if (tc.toolName === "commit_skill") {
            const commitResult = await commitSkillToLibrary(
              input.name,
              input.description,
              input.tags,
              input.code,
              input.language,
              input.verification,
            );

            if (commitResult.ok) {
              this.skillsCommittedThisCycle.push(input.name);
              if (onSkill) await onSkill({ name: input.name, description: input.description, language: input.language });
            }

            toolResults.push({
              type: "tool-result",
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              input,
              output: { type: "text", value: commitResult.ok
                ? `Skill "${input.name}" committed to library at ${commitResult.path}. You now have ${(await listSkills()).length} skills.`
                : `Failed to commit skill: ${commitResult.error}` },
            });
            continue;
          }

          if (tc.toolName === "complete_cycle") {
            const outcome = input.outcome as string;

            // Update frontier task
            if (this.currentTask) {
              await updateTask(this.currentTask.id, {
                status: outcome === "success" ? "completed" : outcome === "failure" ? (this.currentTask.attempts >= 3 ? "abandoned" : "pending") : "pending",
                skills_produced: this.skillsCommittedThisCycle.length > 0 ? this.skillsCommittedThisCycle : undefined,
              });
            }

            // Propose new tasks from the cycle
            for (const nt of (input.next_tasks || [])) {
              await proposeTask(nt.task, nt.criteria, nt.difficulty);
            }

            // Record cycle
            const cycleEntry = {
              t: new Date().toISOString(),
              cycle: this.cycleCount + 1,
              task: this.currentTask?.task || "unknown",
              outcome,
              summary: input.summary,
              actions: this.currentActionCount,
              skills_committed: this.skillsCommittedThisCycle,
              new_tasks: (input.next_tasks || []).length,
            };
            try {
              appendFileSync(CYCLES_FILE, JSON.stringify(cycleEntry) + "\n", "utf-8");
            } catch {}

            if (onCycle) {
              await onCycle({
                task: this.currentTask?.task || "unknown",
                outcome,
                skills: this.skillsCommittedThisCycle,
                actions: this.currentActionCount,
              });
            }

            toolResults.push({
              type: "tool-result",
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              input,
              output: { type: "text", value: `Cycle #${this.cycleCount + 1} complete. Outcome: ${outcome}. Skills committed: ${this.skillsCommittedThisCycle.length}. New tasks proposed: ${(input.next_tasks || []).length}.` },
            });
            cycleComplete = true;
            continue;
          }

          // Execute bash or browser
          const start = Date.now();
          const execResult = await this.executeTool(tc.toolName, input);
          const ms = Date.now() - start;

          this.currentActionCount++;

          if (onToolResult) {
            await onToolResult(tc.toolName, input, execResult, ms);
          }

          const resultContent = execResult.ok
            ? JSON.stringify(execResult.data).slice(0, 4000)
            : `Error: ${execResult.error}`;

          let toolOutput = resultContent;

          // Cycle budget warning
          if (this.currentActionCount === CYCLE_WARNING) {
            toolOutput += `\n\n[SYSTEM] You have ${CYCLE_BUDGET - CYCLE_WARNING} actions left in this cycle. If you have a working solution, commit it as a skill. If not, consider calling complete_cycle.`;
          }

          toolResults.push({
            type: "tool-result",
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input,
            output: { type: "text", value: toolOutput },
          });
        }

        this.messages.push(...result.response.messages);
        this.pushMessage({ role: "tool", content: toolResults });
      }

      this.cycleCount++;

      // Save checkpoint
      await this.saveCheckpoint();

      // Handle sleep between cycles
      if (sleepRequested) {
        const secs = sleepRequested;
        const summary = `Completed cycle #${this.cycleCount}: ${this.currentTask?.task || "unknown"}`;
        await fs.writeFile('.sys/sleep.json', JSON.stringify({ wake_at: new Date(Date.now() + secs * 1000).toISOString() }));
        if (onSleep) await onSleep(secs, summary, this.currentActionCount);

        await closeBrowser();
        console.log(`[mind] sleeping ${secs}s between cycles`);
        this.sleepStartedAt = Date.now();
        await this.interruptibleSleep(secs * 1000);
        await fs.unlink('.sys/sleep.json').catch(() => {});
        const actualSlept = Math.round((Date.now() - this.sleepStartedAt) / 1000);
        this.sleepStartedAt = null;

        const reason = this.wakeReason;
        this.wakeReason = null;
        if (reason && onWake) {
          await onWake(reason, "external");
        } else if (!reason && onWake) {
          await onWake(`Sleep timer expired (${actualSlept}s)`, "timer");
        }
      }
    }
  }

  // --- Seed tasks: bootstrap the frontier from purpose ---
  private async proposeSeedTasks(purpose: string) {
    console.log("[mind] frontier empty, proposing seed tasks from purpose");

    const systemPrompt = `You are a task planner for an autonomous creature. Given the creature's purpose, propose 3-5 concrete tasks that will build foundational skills. Each task should be achievable and produce a reusable skill.

Return your tasks using the propose_tasks tool.`;

    const proposeTools = {
      propose_tasks: tool({
        description: "Propose tasks for the frontier",
        inputSchema: z.object({
          tasks: z.array(z.object({
            task: z.string(),
            criteria: z.string(),
            difficulty: z.number(),
          })),
        }),
      }),
    };

    try {
      const result = await generateText({
        model: provider(MODEL),
        maxOutputTokens: 4096,
        system: systemPrompt,
        tools: proposeTools,
        messages: [{ role: "user", content: `Purpose:\n${purpose}\n\nPropose 3-5 foundational tasks.` }],
      });

      for (const tc of result.toolCalls) {
        if (tc.toolName === "propose_tasks") {
          const input = tc.input as { tasks: Array<{ task: string; criteria: string; difficulty: number }> };
          for (const t of input.tasks) {
            await proposeTask(t.task, t.criteria, t.difficulty);
          }
          console.log(`[mind] proposed ${input.tasks.length} seed tasks`);
        }
      }
    } catch (err) {
      console.error("[mind] failed to propose seed tasks:", err);
      await proposeTask("Explore the environment and understand available tools", "Successfully list files, check git status, and verify bash access", 1);
      await proposeTask("Test network connectivity and API access", "Successfully make an HTTP request and parse the response", 1);
    }
  }

  // --- Tool execution ---
  private async executeTool(name: string, args: Record<string, any>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    if (name === "bash") {
      const result = await executeBash(args.command, {
        cwd: args.cwd || "/creature",
        timeout: args.timeout,
      });
      const combined = [result.stdout, result.stderr].filter(Boolean).join("\n---\n");
      return result.exitCode === 0
        ? { ok: true, data: { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode } }
        : { ok: false, error: `Exit ${result.exitCode}${result.timedOut ? " (timeout)" : ""}:\n${combined}` };
    }

    if (name === "browser") {
      const browserResult = await executeBrowser(args.action, args);
      if (!browserResult.ok) return { ok: false, error: browserResult.error };
      const output = browserResult.snapshot || (browserResult.data ? String(browserResult.data) : "ok");
      return { ok: true, data: { snapshot: browserResult.snapshot, data: browserResult.data } };
    }

    if (name === "janee") {
      const result = await executeJanee(args as any);
      return { ok: true, data: result };
    }

    return { ok: false, error: `Unknown tool: ${name}` };
  }

  // --- Conversation management ---
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

  // --- Checkpoint ---
  private async saveCheckpoint() {
    try {
      const entry = {
        t: new Date().toISOString(),
        cycle: this.cycleCount,
        task: this.currentTask?.task || "unknown",
        actions: this.currentActionCount,
        skills_committed: this.skillsCommittedThisCycle,
      };
      await fs.appendFile(ITERATIONS_FILE, JSON.stringify(entry) + "\n", "utf-8");
    } catch {}
  }

  // --- Sleep ---
  private interruptibleSleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      const start = Date.now();
      this.sleepResolve = resolve;

      const timer = setTimeout(() => {
        this.sleepResolve = null;
        resolve();
      }, ms);

      // Wall-clock watchdog: compensate for host machine sleep
      const watchdog = setInterval(() => {
        const elapsed = Date.now() - start;
        if (elapsed >= ms) {
          clearInterval(watchdog);
          clearTimeout(timer);
          this.sleepResolve = null;
          resolve();
        }
      }, 30_000);

      // Store cleanup for forceWake
      const originalResolve = this.sleepResolve;
      this.sleepResolve = () => {
        clearTimeout(timer);
        clearInterval(watchdog);
        originalResolve?.();
        resolve();
      };
    });
  }

  private async loadPurpose(): Promise<string> {
    try {
      return (await fs.readFile("PURPOSE.md", "utf-8")).trim();
    } catch {
      return "No purpose defined yet.";
    }
  }
}
