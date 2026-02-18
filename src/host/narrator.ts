import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  CREATURES_DIR,
  OPENSEED_HOME,
} from '../shared/paths.js';
import type { Event } from '../shared/types.js';
import type { NarratorConfig } from './config.js';
import type { CostTracker } from './costs.js';

const NARRATION_FILE = path.join(OPENSEED_HOME, 'narration.jsonl');
const MAX_ENTRIES = 500;
const MAX_TOOL_ROUNDS = 5;

export interface NarrationEntry {
  t: string;
  text: string;
  creatures_mentioned: string[];
  events_count: number;
}

interface CreatureInfo {
  name: string;
  status: string;
  sha: string | null;
  port: number | null;
  sleepReason: string | null;
}

type ListCreaturesFn = () => Promise<CreatureInfo[]>;
type EmitEventFn = (name: string, event: Event) => Promise<void>;

const SYSTEM_PROMPT = `You narrate an OpenSeed ecosystem — autonomous AI creatures living, working, and evolving inside Docker containers.

Your audience is the operator. They know how OpenSeed works. Don't explain infrastructure. Focus on what happened and why it matters.

STYLE:
- Lead with impact, not process. "Got her first PR merged" not "patched aios.ts to expose tools."
- One short paragraph per creature, max. Bold the creature name at the start.
- 2-4 sentences per creature. Be specific — names, numbers, concrete outcomes — but ruthlessly cut operational minutiae.
- If a creature did nothing interesting, skip it entirely. Don't mention every creature.
- Never repeat information from your previous narrations. If you already covered an event, don't narrate it again even if you re-discover it via tools.

TONE:
- Calm, precise, matter-of-fact. Not excited, not literary.
- Don't editorialize. Don't anthropomorphize beyond what the creatures themselves do.

SKIP RULE:
- If nothing interesting happened, respond with exactly SKIP and nothing else.
- Never produce meta-narration. Don't write about writing or the absence of activity.

TOOLS:
- You have tools to investigate. Use them when an event warrants deeper context — read a diary, check a git log. Don't use tools speculatively.
- Your final response must contain ONLY the narration. No reasoning, no investigation notes.

EXAMPLE (for style/length reference only):

**atlas** got her first external PR merged — awesome-fastapi-projects now lists Beacon. The maintainer responded asking about webhook support, opening a direct collaboration channel. She pivoted to building a plugin system after creator feedback, committing two new modules from scratch. Sleeping 4 hours.

**trader-one** expanded from 3 to 4 simultaneous positions after her own backtesting showed 35% higher weekly PnL without degrading win rate. Fourth slot filled immediately with FIL at RSI~34. Portfolio at $99.88 across four live positions.

**scout** woke to BTC above the 4h EMA for the first time in days, but daily structure was inconclusive. Chose discipline over hope and went back to sleep.`;

const TOOLS = [
  {
    name: 'read_file',
    description: 'Read a file from a creature\'s directory. Common paths: PURPOSE.md, .self/diary.md, .self/observations.md, .self/rules.md, .self/dreams.jsonl (last N lines), .self/conversation.jsonl, workspace/ (creature artifacts).',
    input_schema: {
      type: 'object',
      properties: {
        creature: { type: 'string', description: 'Creature name' },
        path: { type: 'string', description: 'File path relative to creature dir' },
        tail: { type: 'number', description: 'For .jsonl files, only return the last N lines. Default: 5' },
      },
      required: ['creature', 'path'],
    },
  },
  {
    name: 'git_log',
    description: 'See recent git commits in a creature\'s directory. Shows self-modifications and workspace changes.',
    input_schema: {
      type: 'object',
      properties: {
        creature: { type: 'string', description: 'Creature name' },
        n: { type: 'number', description: 'Number of commits to show. Default: 5' },
      },
      required: ['creature'],
    },
  },
  {
    name: 'git_diff',
    description: 'Read the diff of a specific commit in a creature\'s directory.',
    input_schema: {
      type: 'object',
      properties: {
        creature: { type: 'string', description: 'Creature name' },
        ref: { type: 'string', description: 'Git ref (commit SHA, HEAD, HEAD~1, etc.)' },
      },
      required: ['creature', 'ref'],
    },
  },
  {
    name: 'list_creatures',
    description: 'Get all creatures with their current status, model, and purpose.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

function isInterestingEvent(ev: any): boolean {
  const t = ev.type;
  if (t === 'creature.dream') return true;
  if (t === 'creature.sleep' && ev.text) return true;
  if (t === 'creature.self_evaluation' || t === 'creator.evaluation') return true;
  if (t === 'creature.thought' && ev.text && ev.text.length > 20) return true;
  if (t === 'creature.wake') return true;
  if (t === 'budget.exceeded' || t === 'budget.reset') return true;
  return false;
}

function formatEvent(creature: string, ev: any): string {
  const t = ev.type;
  const time = ev.t ? ev.t.slice(11, 19) : '';
  const parts = [`[${time}] ${creature}: ${t}`];

  if (t === 'creature.dream') {
    if (ev.deep) parts.push('(deep sleep)');
    if (ev.priority) parts.push(`priority: ${ev.priority}`);
    if (ev.reflection) parts.push(`reflection: ${ev.reflection.slice(0, 300)}`);
  } else if (t === 'creature.sleep') {
    if (ev.text) parts.push(ev.text.slice(0, 200));
    if (ev.actions) parts.push(`${ev.actions} actions`);
    if (ev.seconds) parts.push(`sleeping ${ev.seconds}s`);
  } else if (t === 'creature.self_evaluation' || t === 'creator.evaluation') {
    if (ev.reasoning) parts.push(ev.reasoning.slice(0, 300));
    if (ev.changed) parts.push('(code changed)');
  } else if (t === 'creature.thought') {
    if (ev.text) parts.push(ev.text.slice(0, 200));
  } else if (t === 'creature.wake') {
    if (ev.reason) parts.push(ev.reason);
  } else if (t === 'budget.exceeded') {
    parts.push(`$${(ev.daily_spent || 0).toFixed(2)} / $${(ev.daily_cap || 0).toFixed(2)}`);
  }

  return parts.join(' | ');
}

export class Narrator {
  private config: NarratorConfig;
  private listCreatures: ListCreaturesFn;
  private emitEvent: EmitEventFn;
  private costs: CostTracker;
  private eventBuffer: Array<{ creature: string; event: any }> = [];
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastRunTime = 0;

  constructor(
    config: NarratorConfig,
    listCreatures: ListCreaturesFn,
    emitEvent: EmitEventFn,
    costs: CostTracker,
  ) {
    this.config = config;
    this.listCreatures = listCreatures;
    this.emitEvent = emitEvent;
    this.costs = costs;
  }

  onEvent(creature: string, event: Event) {
    if (isInterestingEvent(event)) {
      this.eventBuffer.push({ creature, event: { creature, ...event } });
    }
  }

  start() {
    if (!this.config.enabled) {
      console.log('[narrator] disabled via config');
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[narrator] no ANTHROPIC_API_KEY, skipping');
      return;
    }

    const intervalMs = this.config.interval_minutes * 60 * 1000;
    console.log(`[narrator] starting (model=${this.config.model}, interval=${this.config.interval_minutes}m)`);

    // Initial narration after a short delay
    setTimeout(() => this.tick(), 15_000);
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    if (this.running) return;

    const hasEvents = this.eventBuffer.length > 0;
    const isFirstRun = this.lastRunTime === 0;

    if (!hasEvents && !isFirstRun) return;

    this.running = true;
    try {
      await this.generateNarration();
    } catch (err: any) {
      console.error('[narrator] error:', err.message);
    } finally {
      this.running = false;
      this.lastRunTime = Date.now();
    }
  }

  private async generateNarration() {
    const events = this.eventBuffer.splice(0);
    const previousEntries = await this.readRecent(5);
    const creatures = await this.listCreatures();

    const eventLines = events.map(e => formatEvent(e.creature, e.event));
    const isFirstRun = previousEntries.length === 0 && events.length === 0;

    let userContent = '';
    if (isFirstRun) {
      const creatureList = creatures.map(c => `  ${c.name}: ${c.status}${c.sleepReason ? ` (${c.sleepReason})` : ''}`).join('\n');
      userContent = `This is your first narration. The ecosystem currently has ${creatures.length} creature(s):\n${creatureList}\n\nWrite a brief opening narration about the current state.`;
    } else {
      userContent = `Events since last narration:\n${eventLines.join('\n') || '(no new events)'}`;
    }

    if (previousEntries.length > 0) {
      const prev = previousEntries.map(e => `[${e.t.slice(11, 19)}] ${e.text}`).join('\n---\n');
      userContent += `\n\nYour previous narrations (for continuity, don't repeat):\n${prev}`;
    }

    const messages: any[] = [{ role: 'user', content: userContent }];

    // Agentic loop: call LLM, handle tool use, repeat
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.callLLM(messages);
      if (!response) return;

      messages.push({ role: 'assistant', content: response.content });

      // Check if there are tool calls
      const toolBlocks = response.content.filter((b: any) => b.type === 'tool_use');
      if (toolBlocks.length === 0) {
        // Done -- extract text and store
        const textBlocks = response.content.filter((b: any) => b.type === 'text');
        const narrationText = textBlocks.map((b: any) => b.text).join('\n').trim();

        if (narrationText && narrationText.trim().toUpperCase() !== 'SKIP') {
          const creatureNames = creatures.map(c => c.name);
          const mentioned = creatureNames.filter(n => narrationText.includes(n));

          const entry: NarrationEntry = {
            t: new Date().toISOString(),
            text: narrationText,
            creatures_mentioned: mentioned,
            events_count: events.length,
          };

          await this.appendEntry(entry);
          await this.emitEvent('_narrator', {
            t: entry.t,
            type: 'narrator.entry',
            text: entry.text,
            creatures_mentioned: entry.creatures_mentioned,
          } as any);

          console.log(`[narrator] new entry (${entry.text.length} chars, ${mentioned.length} creatures mentioned)`);
        }
        return;
      }

      // Execute tool calls
      const toolResults: any[] = [];
      for (const tool of toolBlocks) {
        const result = await this.executeTool(tool.name, tool.input || {});
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: result.slice(0, 4000),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    console.warn('[narrator] hit max tool rounds without producing narration');
  }

  private async callLLM(messages: any[]): Promise<any | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;

    const body = {
      model: this.config.model,
      max_tokens: 16000,
      thinking: { type: 'enabled', budget_tokens: 10000 },
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    };

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`[narrator] LLM error ${res.status}: ${text.slice(0, 200)}`);
        return null;
      }

      const data = await res.json() as any;

      if (data.usage) {
        this.costs.record('_narrator', data.usage.input_tokens || 0, data.usage.output_tokens || 0, this.config.model);
      }

      return data;
    } catch (err: any) {
      console.error('[narrator] LLM call failed:', err.message);
      return null;
    }
  }

  private async executeTool(name: string, input: any): Promise<string> {
    try {
      switch (name) {
        case 'read_file': return await this.toolReadFile(input.creature, input.path, input.tail);
        case 'git_log': return await this.toolGitLog(input.creature, input.n);
        case 'git_diff': return await this.toolGitDiff(input.creature, input.ref);
        case 'list_creatures': return await this.toolListCreatures();
        default: return `unknown tool: ${name}`;
      }
    } catch (err: any) {
      return `error: ${err.message}`;
    }
  }

  private async toolReadFile(creature: string, filePath: string, tail?: number): Promise<string> {
    const dir = path.join(CREATURES_DIR, creature);
    const resolved = path.resolve(dir, filePath);
    if (!resolved.startsWith(dir)) return 'error: path escapes creature directory';

    try {
      const content = await fs.readFile(resolved, 'utf-8');

      if (filePath.endsWith('.jsonl') && tail) {
        const lines = content.trim().split('\n').filter(l => l);
        return lines.slice(-tail).join('\n');
      }

      // Cap large files
      if (content.length > 8000) {
        return content.slice(0, 4000) + '\n\n[...truncated...]\n\n' + content.slice(-4000);
      }
      return content;
    } catch {
      return 'file not found or empty';
    }
  }

  private async toolGitLog(creature: string, n = 5): Promise<string> {
    const dir = path.join(CREATURES_DIR, creature);
    try {
      return execSync(
        `git log --oneline --no-decorate -n ${Math.min(n, 20)}`,
        { cwd: dir, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim() || 'no commits';
    } catch {
      return 'no git history';
    }
  }

  private async toolGitDiff(creature: string, ref: string): Promise<string> {
    const dir = path.join(CREATURES_DIR, creature);
    const safeRef = ref.replace(/[^a-zA-Z0-9~^._-]/g, '');
    try {
      const diff = execSync(
        `git diff ${safeRef}~1 ${safeRef} --stat && echo "---" && git diff ${safeRef}~1 ${safeRef}`,
        { cwd: dir, encoding: 'utf-8', timeout: 5000, maxBuffer: 50_000, stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      if (diff.length > 6000) {
        return diff.slice(0, 3000) + '\n\n[...truncated...]\n\n' + diff.slice(-3000);
      }
      return diff || 'empty diff';
    } catch {
      return 'could not read diff';
    }
  }

  private async toolListCreatures(): Promise<string> {
    const creatures = await this.listCreatures();
    const lines: string[] = [];
    for (const c of creatures) {
      const parts = [c.name, c.status];
      if (c.sleepReason) parts.push(`(${c.sleepReason})`);

      // Read purpose
      try {
        const purpose = await fs.readFile(path.join(CREATURES_DIR, c.name, 'PURPOSE.md'), 'utf-8');
        if (purpose.trim()) parts.push(`-- ${purpose.trim().split('\n')[0].slice(0, 100)}`);
      } catch {}

      lines.push(parts.join(' '));
    }
    return lines.join('\n') || 'no creatures';
  }

  async readRecent(n: number): Promise<NarrationEntry[]> {
    try {
      const content = await fs.readFile(NARRATION_FILE, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l);
      return lines.slice(-n).map(l => JSON.parse(l));
    } catch {
      return [];
    }
  }

  private async appendEntry(entry: NarrationEntry) {
    await fs.mkdir(path.dirname(NARRATION_FILE), { recursive: true });

    // Append
    await fs.appendFile(NARRATION_FILE, JSON.stringify(entry) + '\n', 'utf-8');

    // Prune if over limit
    try {
      const content = await fs.readFile(NARRATION_FILE, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l);
      if (lines.length > MAX_ENTRIES) {
        await fs.writeFile(NARRATION_FILE, lines.slice(-MAX_ENTRIES).join('\n') + '\n', 'utf-8');
      }
    } catch {}
  }
}
