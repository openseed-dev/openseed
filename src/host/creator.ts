import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import Anthropic from '@anthropic-ai/sdk';

import { CostTracker } from './costs.js';
import { Event } from '../shared/types.js';
import { EventStore } from './events.js';
import { CreatureSupervisor } from './supervisor.js';

const MODEL = 'claude-opus-4-6';
const MAX_TURNS = 30;
const CREATOR_LOG = '.self/creator-log.jsonl';

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read a file from the creature\'s directory. Path is relative to the creature root.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path (e.g. "src/mind.ts", ".self/rules.md")' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write/overwrite a file in the creature\'s directory. Path is relative to creature root.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path' },
        content: { type: 'string', description: 'Full file content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in the creature\'s directory, optionally filtered by subdirectory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        subdir: { type: 'string', description: 'Subdirectory to list (default: root). e.g. "src", ".self", "src/tools"' },
      },
      required: [],
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
    name: 'suspend',
    description: 'Stop the creature\'s container. Call this before making code changes.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'rebuild_and_restart',
    description: 'Rebuild the creature\'s Docker image and restart it. Call after writing code changes.',
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

You can modify any file in the creature's directory:
- **src/mind.ts** — the cognitive core. System prompt, consolidation logic, sleep/wake, progress checks, fatigue. This is where the biggest leverage is.
- **src/tools/** — tool implementations (bash, browser). You can change timeouts, add tools, modify behavior.
- **src/index.ts** — the creature's main loop and event emission.
- **PURPOSE.md** — the creature's purpose (change with extreme caution).
- **.self/rules.md** — learned behavioral rules.

## How to Make Changes

1. Read the creature's current state (dreams, events, rules, code)
2. Diagnose what's working and what isn't
3. If changes are needed: call suspend() first, then write your changes, then rebuild_and_restart()
4. If no changes needed: call done() with your reasoning

## Important Principles

- **Be targeted.** Don't rewrite everything. Identify one or two specific improvements.
- **Check your previous interventions.** Read .self/creator-log.jsonl to see what you changed before and whether it helped. Don't repeat failed experiments.
- **Preserve what works.** If the creature has learned good rules or developed effective patterns, don't disrupt them.
- **Git safety net exists.** If your changes break the creature, it will be rolled back automatically. Be bold but thoughtful.
- **Think in terms of cognitive architecture, not tasks.** Don't tell the creature WHAT to do — change HOW it thinks.
- **Be efficient.** You have a limited number of turns. Read what you need, make your changes, and call done(). Don't exhaustively read every file — skim, diagnose, act.
- **Always call done().** When you're finished (whether you made changes or not), you MUST call done() with your reasoning. This is how your evaluation gets logged.`;
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
  ): Promise<void> {
    console.log(`[creator] evaluating creature "${name}" (trigger: ${trigger})`);

    const system = buildCreatorPrompt(name);

    // Build initial context
    const context = await this.buildContext(name, dir, store);

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

      // Track token costs
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
            case 'read_file': {
              const filePath = path.join(dir, args.path as string);
              result = await fs.readFile(filePath, 'utf-8');
              break;
            }

            case 'write_file': {
              const filePath = path.join(dir, args.path as string);
              await fs.mkdir(path.dirname(filePath), { recursive: true });
              await fs.writeFile(filePath, args.content as string, 'utf-8');
              changedFiles.push(args.path as string);
              result = `Written: ${args.path}`;
              console.log(`[creator] wrote ${args.path}`);
              break;
            }

            case 'list_files': {
              const subdir = args.subdir as string || '.';
              const target = path.join(dir, subdir);
              const entries = await fs.readdir(target, { withFileTypes: true });
              result = entries
                .map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`)
                .join('\n');
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
                  `[${d.t?.slice(0, 16)}] ${d.actions} actions | deep=${d.deep}\nReflection: ${d.reflection}\nPriority: ${d.priority}\nObservations: ${d.observations}`
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

            case 'suspend': {
              console.log(`[creator] suspending creature "${name}"`);
              // Git commit current state before changes
              try {
                execSync('git add -A && git commit -m "creator: pre-evolution snapshot" --allow-empty', {
                  cwd: dir, stdio: 'ignore',
                });
              } catch {}
              await supervisor.stop();
              result = 'Creature suspended. You can now write changes.';
              break;
            }

            case 'rebuild_and_restart': {
              console.log(`[creator] rebuilding and restarting creature "${name}"`);
              // Git commit the changes
              try {
                execSync(`git add -A && git commit -m "creator: ${changedFiles.join(', ')}"`, {
                  cwd: dir, stdio: 'ignore',
                });
              } catch {}
              // Rebuild Docker image
              try {
                execSync(`docker build -t creature-${name} .`, {
                  cwd: dir, stdio: 'ignore', timeout: 120_000,
                });
              } catch (err) {
                result = `Docker build failed: ${err instanceof Error ? err.message : String(err)}`;
                break;
              }
              await supervisor.start();
              result = 'Creature rebuilt and restarted.';
              break;
            }

            case 'done': {
              reasoning = args.reasoning as string;
              changed = args.changed as boolean;
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

      // Nudge to wrap up when running low on turns
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

    // Log the evaluation
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

    // Emit event
    await onEvent(name, {
      t: new Date().toISOString(),
      type: 'creator.evaluation',
      reasoning: reasoning.slice(0, 500),
      changes: changedFiles,
      trigger,
    } as Event);

    console.log(`[creator] evaluation complete for "${name}" — changed=${changed}, turns=${turns}`);
  }

  private async buildContext(name: string, dir: string, store: EventStore): Promise<string> {
    let context = `Evaluate creature "${name}". Read its state and decide whether its cognitive architecture needs improvement.\n\n`;

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

    context += 'Start by reading the creature\'s recent dreams, rules, events, and source code to get a feel for how it\'s doing.\n';
    return context;
  }
}
