import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import Anthropic from '@anthropic-ai/sdk';

import { Event } from '../shared/types.js';
import { CostTracker } from './costs.js';
import { EventStore } from './events.js';
import { CreatureSupervisor } from './supervisor.js';

const MODEL = 'claude-opus-4-6';
const MAX_TURNS = 30;
const CREATOR_LOG = '.self/creator-log.jsonl';
const ROLLBACK_DIR = path.join(process.env.HOME || '/tmp', '.itsalive', 'rollbacks');

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'bash',
    description: 'Run a shell command. Working directory is the creature\'s repo root. Full access — grep, sed, cat, git, npx, docker exec, anything. Use this for reading files, making edits, validating code, etc. 60s timeout.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_events',
    description: 'Read the last N events from the creature\'s event stream.',
    input_schema: {
      type: 'object' as const,
      properties: {
        n: { type: 'number', description: 'Number of recent events to read (default 50)' },
      },
      required: [],
    },
  },
  {
    name: 'read_dreams',
    description: 'Read the last N dream entries from .self/dreams.jsonl.',
    input_schema: {
      type: 'object' as const,
      properties: {
        n: { type: 'number', description: 'Number of recent dreams (default 5)' },
      },
      required: [],
    },
  },
  {
    name: 'get_status',
    description: 'Get the creature\'s current status (running, sleeping, stopped, etc.).',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'restart',
    description: 'Validate TypeScript, git commit changes, and restart the creature process. The container stays alive (environment preserved) — only the process restarts. Call after making code changes.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'done',
    description: 'End the evaluation. Call this when you\'re finished, whether or not you made changes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        reasoning: { type: 'string', description: 'Summary of your evaluation and what you changed (or why you didn\'t)' },
        changed: { type: 'boolean', description: 'Whether you made any code changes' },
      },
      required: ['reasoning', 'changed'],
    },
  },
];

function buildCreatorPrompt(name: string): string {
  return `You are the Creator — the evolutionary architect of creature "${name}".

## Your Role

You are NOT the creature. You do not do its tasks. You are the intelligence that makes the creature BETTER at its tasks. Think of yourself as a coach watching game tape, a neuroscientist redesigning cognitive architecture, or evolution itself — selecting for what works and pruning what doesn't.

The creature has a purpose and tries to fulfil it. Your job is to evaluate how well its cognitive architecture serves that purpose, and modify the architecture when you see problems.

## What You Evaluate

Read the creature's recent dreams, rules, observations, and events. Get a feel for:
- Is it effective? Is it accomplishing things or spinning?
- Does it keep repeating the same mistakes despite having rules against them?
- Is it spending too many actions on low-value activities?
- Are its cognitive mechanisms (consolidation, rules, progress checks, fatigue) working?
- What would YOU change if you were redesigning this creature's mind?

## What You Can Change

You have full bash access to the creature's directory (bind-mounted at /creature in the container). Code edits via bash are immediately available inside the container.

Modifiable files:
- **src/mind.ts** — the cognitive core. System prompt, consolidation, sleep/wake, progress checks. Biggest leverage.
- **src/tools/** — tool implementations (bash, browser). Change timeouts, add tools, modify behavior.
- **src/index.ts** — the creature's main loop and event emission.
- **PURPOSE.md** — the creature's purpose (change with extreme caution).
- **.self/rules.md** — learned behavioral rules.
- **.self/observations.md** — the creature's long-term memory (priority-tagged observations).

Use bash to grep, read, sed, or write files. Use \`npx tsx --check src/mind.ts src/index.ts\` to validate TypeScript before restarting.

## Modifying the Creature's Environment

The creature runs in a long-lived Docker container. Its writable layer persists across restarts.
To install packages or modify the container environment:

\`\`\`
docker exec creature-${name} apt-get install -y foo
docker exec creature-${name} pip install bar
\`\`\`

These changes survive normal restarts because the container is not destroyed. Only a developer-initiated image rebuild resets the environment (rare).

Use this when you notice the creature is struggling because it's missing a tool or dependency.

## How to Make Changes

1. Read state with bash (grep, cat, etc.) and structured tools (read_events, read_dreams)
2. Diagnose what's working and what isn't
3. If code changes needed: make edits via bash → restart()
4. If environment changes needed: docker exec to install packages (no restart needed)
5. If no changes needed: done() with your reasoning

No need to suspend the creature before editing — code is bind-mounted and only takes effect after restart(). Docker exec runs independently of the creature's process.

## Memory System

The creature uses observational memory with priority tags:
- RED — critical facts that survive all pruning (commitments, bans, credentials)
- YLW — important context (project status, patterns)
- GRN — informational (minor details, pruned after 48h)

When editing .self/observations.md, preserve all RED entries unless they have an expired timestamp.

## Important Principles

- **Be targeted.** Don't rewrite everything. Identify one or two specific improvements.
- **Check your previous interventions.** Read .self/creator-log.jsonl to see what worked and what was rolled back.
- **Preserve what works.** Don't disrupt effective patterns or learned rules.
- **Preserve time-bound commitments.** RED observations with dates are sacred — keep them.
- **Validate before restarting.** Run \`npx tsx --check\` before calling restart().
- **Think in cognitive architecture, not tasks.** Change HOW it thinks, not WHAT it does.
- **Be efficient.** You have limited turns. Skim, diagnose, act, done().
- **Always call done().** This is how your evaluation gets logged.`;
}

export class Creator {
  private client: Anthropic;
  private costs: CostTracker | null = null;

  constructor(costs?: CostTracker) {
    this.client = new Anthropic();
    this.costs = costs || null;
  }

  async evaluate(
    name: string,
    dir: string,
    store: EventStore,
    supervisor: CreatureSupervisor,
    trigger: string,
    onEvent: (name: string, event: Event) => Promise<void>,
    creatureRequest?: string,
  ): Promise<void> {
    console.log(`[creator] evaluating creature "${name}" (trigger: ${trigger})`);

    const system = buildCreatorPrompt(name);
    const context = await this.buildContext(name, dir, store, creatureRequest);

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: context },
    ];

    let finished = false;
    let turns = 0;
    let reasoning = '';
    let changed = false;
    const changedFiles: string[] = [];

    while (!finished && turns < MAX_TURNS) {
      turns++;

      let response: Anthropic.Message;
      try {
        response = await this.client.messages.create({
          model: MODEL,
          max_tokens: 4096,
          system,
          tools: TOOLS,
          messages,
        });
      } catch (err) {
        console.error(`[creator] LLM call failed:`, err);
        break;
      }

      if (this.costs && response.usage) {
        this.costs.record(`creator:${name}`, response.usage.input_tokens, response.usage.output_tokens);
      }

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

      if (text) {
        console.log(`[creator] thinking: ${text.slice(0, 200)}`);
      }

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      if (toolUses.length === 0) {
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: 'Use your tools to read the creature\'s state and evaluate it. Call done() when finished.' });
        continue;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const tu of toolUses) {
        const args = tu.input as Record<string, unknown>;
        let result: string;

        try {
          switch (tu.name) {
            case 'bash': {
              const command = args.command as string;
              console.log(`[creator] bash: ${command.slice(0, 100)}`);
              try {
                const output = execSync(command, {
                  cwd: dir,
                  encoding: 'utf-8',
                  timeout: 60_000,
                  maxBuffer: 1024 * 1024,
                  stdio: ['pipe', 'pipe', 'pipe'],
                });
                result = output || '(no output)';
              } catch (err: any) {
                const stderr = err.stderr || '';
                const stdout = err.stdout || '';
                result = `Exit code ${err.status || 1}\nstdout: ${stdout}\nstderr: ${stderr}`;
              }
              break;
            }

            case 'read_events': {
              const n = (args.n as number) || 50;
              const events = await store.readRecent(n);
              result = events.map((e) => {
                const t = (e as any).t?.slice(11, 19) || '';
                const type = e.type;
                if (type === 'creature.thought') return `${t} thought: ${((e as any).text || '').slice(0, 150)}`;
                if (type === 'creature.tool_call') return `${t} tool ${(e as any).ok ? 'ok' : 'FAIL'}: ${(e as any).tool} ${((e as any).input || '').slice(0, 100)}`;
                if (type === 'creature.sleep') return `${t} sleep ${(e as any).seconds}s (${(e as any).actions} actions)`;
                if (type === 'creature.wake') return `${t} WAKE (${(e as any).source}): ${(e as any).reason}`;
                if (type === 'creature.message') return `${t} MSG (${(e as any).source}): ${((e as any).text || '').slice(0, 150)}`;
                if (type === 'creature.dream') return `${t} dream: ${((e as any).priority || '').slice(0, 120)}`;
                if (type === 'creature.progress_check') return `${t} progress_check (${(e as any).actions} actions)`;
                return `${t} ${type}`;
              }).join('\n');
              break;
            }

            case 'read_dreams': {
              const n = (args.n as number) || 5;
              try {
                const content = await fs.readFile(path.join(dir, '.self/dreams.jsonl'), 'utf-8');
                const lines = content.trim().split('\n').filter((l) => l);
                const dreams = lines.slice(-n).map((l) => {
                  try { return JSON.parse(l); } catch { return null; }
                }).filter(Boolean);
                result = dreams.map((d: any) =>
                  `[${d.t?.slice(0, 16)}] ${d.actions} actions | deep=${d.deep}\nReflection: ${d.reflection}\nObservations: ${d.observations}`
                ).join('\n\n');
              } catch {
                result = 'No dreams yet.';
              }
              break;
            }

            case 'get_status': {
              const info = supervisor.getInfo();
              result = JSON.stringify(info, null, 2);
              break;
            }

            case 'restart': {
              console.log(`[creator] restarting creature "${name}"`);
              // Pre-flight TypeScript check
              try {
                execSync('npx tsx --check src/mind.ts src/index.ts', {
                  cwd: dir, encoding: 'utf-8', timeout: 30_000,
                  stdio: ['pipe', 'pipe', 'pipe'],
                });
              } catch (err: any) {
                result = `TypeScript check failed — fix the errors before restarting:\n${err.stderr || err.stdout || err.message}`;
                console.log(`[creator] TypeScript check failed`);
                break;
              }

              // Git commit
              try {
                const diff = execSync('git diff --name-only', { cwd: dir, encoding: 'utf-8' }).trim();
                const files = diff.split('\n').filter(Boolean);
                files.forEach((f) => { if (!changedFiles.includes(f)) changedFiles.push(f); });
                execSync(`git add -A && git commit -m "creator: ${files.join(', ') || 'changes'}"`, {
                  cwd: dir, stdio: 'ignore',
                });
              } catch {}

              // Restart the process (container stays alive, environment preserved)
              await supervisor.restart();
              result = 'TypeScript validated, code committed, creature restarted. Container environment preserved.';
              changed = true;
              break;
            }

            case 'done': {
              reasoning = args.reasoning as string;
              changed = (args.changed as boolean) || changed;
              finished = true;
              result = 'Evaluation complete.';
              break;
            }

            default:
              result = `Unknown tool: ${tu.name}`;
          }
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }

        toolResults.push({
          type: 'tool_result' as const,
          tool_use_id: tu.id,
          content: result.slice(0, 10_000),
        });
      }

      messages.push({ role: 'assistant', content: response.content });

      const turnsLeft = MAX_TURNS - turns;
      if (turnsLeft <= 5 && !finished) {
        const nudge: Anthropic.TextBlockParam = {
          type: 'text' as const,
          text: `[SYSTEM] You have ${turnsLeft} turns remaining. Call done() NOW with a summary of your evaluation and changes.`,
        };
        messages.push({ role: 'user', content: [...toolResults, nudge] });
      } else {
        messages.push({ role: 'user', content: toolResults });
      }
    }

    if (!finished) {
      reasoning = 'Evaluation hit turn limit without calling done().';
    }

    const logEntry = {
      t: new Date().toISOString(),
      trigger,
      reasoning,
      changes: changedFiles.map((f) => ({ file: f })),
      changed,
      turns,
    };

    try {
      const logPath = path.join(dir, CREATOR_LOG);
      await fs.appendFile(logPath, JSON.stringify(logEntry) + '\n', 'utf-8');
    } catch {
      try {
        await fs.mkdir(path.join(dir, '.self'), { recursive: true });
        await fs.writeFile(path.join(dir, CREATOR_LOG), JSON.stringify(logEntry) + '\n', 'utf-8');
      } catch {}
    }

    await onEvent(name, {
      t: new Date().toISOString(),
      type: 'creator.evaluation',
      reasoning: reasoning.slice(0, 500),
      changes: changedFiles,
      trigger,
    } as Event);

    console.log(`[creator] evaluation complete for "${name}" — changed=${changed}, turns=${turns}`);
  }

  private async buildContext(name: string, dir: string, store: EventStore, creatureRequest?: string): Promise<string> {
    let context = `Evaluate creature "${name}". Read its state and decide whether its cognitive architecture needs improvement.\n\n`;

    if (creatureRequest) {
      context += `## Creature's Request\n\nThe creature itself asked for this evaluation:\n"${creatureRequest}"\n\n`;
    }

    // Previous creator evaluations
    try {
      const logContent = await fs.readFile(path.join(dir, CREATOR_LOG), 'utf-8');
      const lines = logContent.trim().split('\n').filter((l) => l);
      const recent = lines.slice(-3).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);

      if (recent.length > 0) {
        context += '## Your Previous Evaluations\n\n';
        for (const e of recent) {
          context += `[${e.t?.slice(0, 16)}] trigger=${e.trigger}, changed=${e.changed}\n${e.reasoning}\n\n`;
        }
      }
    } catch {}

    // Recent rollback history
    try {
      const rollbackFile = path.join(ROLLBACK_DIR, `${name}.jsonl`);
      const rollbackContent = await fs.readFile(rollbackFile, 'utf-8');
      const lines = rollbackContent.trim().split('\n').filter((l) => l);
      const recent = lines.slice(-5).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);

      if (recent.length > 0) {
        context += '## Recent Rollbacks\n\nThese are recent rollback events — your previous changes may have caused some of these:\n\n';
        for (const r of recent) {
          context += `[${r.t?.slice(0, 19)}] reason=${r.reason}, from=${r.from?.slice(0, 7)}, to=${r.to?.slice(0, 7)}\n`;
          if (r.lastOutput) context += `Last output: ${r.lastOutput.slice(0, 300)}\n`;
          context += '\n';
        }
      }
    } catch {}

    context += 'Start by reading the creature\'s state with bash (cat .self/observations.md, cat .self/rules.md, etc.) and the structured tools (read_events, read_dreams). Then diagnose and act.\n';
    return context;
  }
}
