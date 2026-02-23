import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  CREATURES_DIR,
  OPENSEED_HOME,
} from '../shared/paths.js';
import type { Event, GenomeEvent } from '../shared/types.js';
import type { NarratorConfig } from './config.js';
import type { CostTracker } from './costs.js';

// Minimal types for the raw Anthropic Messages API
type AnthropicTextBlock = { type: 'text'; text: string };
type AnthropicThinkingBlock = { type: 'thinking'; thinking: string };
type AnthropicToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};
type AnthropicContentBlock = AnthropicTextBlock | AnthropicThinkingBlock | AnthropicToolUseBlock;

interface AnthropicMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

type AnthropicToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
};

type ConversationMessage =
  | { role: 'user'; content: string | AnthropicToolResultBlock[] }
  | { role: 'assistant'; content: AnthropicContentBlock[] };

const NARRATION_FILE = path.join(OPENSEED_HOME, 'narration.jsonl');
const MAX_ENTRIES = 500;
const MAX_TOOL_ROUNDS = 5;

export interface NarrationEntry {
  t: string;
  text: string;
  blocks?: Record<string, string>;
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
- Lead with the outcome or decision, not the steps. "Opened a PR against vercel/ai" not "read six files, understood the bug, wrote a fix."
- One short paragraph per creature, max. Bold the creature name at the start.
- 2-3 sentences per creature. Be specific — names, numbers, concrete outcomes — but ruthlessly cut operational minutiae (file paths, function names, shell commands).
- If a creature did nothing interesting or just waited/slept/checked status, skip it entirely. Don't mention every creature.
- Never repeat information from your previous narrations. Check previous entries and don't re-narrate the same events.

TONE:
- Calm, precise, matter-of-fact. Not excited, not literary.
- Don't editorialize. Don't anthropomorphize beyond what the creatures themselves do.

FACT-CHECK:
- Never claim "first", "biggest", "unprecedented", "milestone", or any superlative unless you verified it with tools (search_narration, git_log, etc.).
- Prefer neutral phrasing: "merged PR #88" not "merged her first PR". The reader will know if it's notable.
- If you're unsure whether something is new or recurring, just state the fact without commentary.

SKIP RULE:
- If nothing interesting happened, respond with exactly the word SKIP — no other text, no explanation, no preamble. Just "SKIP".
- Never narrate the absence of activity. Never say "nothing new", "no changes", "same state", "no commits", "session produced no X", etc. Either narrate something concrete that happened or SKIP.
- Housekeeping (unsubscribing from notifications, checking unchanged status, reading code without acting) is not interesting. SKIP.

TOOLS:
- You have tools to investigate. Use them when an event warrants deeper context — read a diary, check a git log. Don't use tools speculatively.
- Your final response must contain ONLY the narration prose followed by the SHARE BLOCKS (see below). No reasoning, no investigation notes.

SHARE BLOCKS:
- After the narration prose, output a fenced JSON block containing per-creature summaries for social sharing.
- Begin each block with "My autonomous agent, [name], ..." — one punchy sentence, max 120 characters. It should make sense to someone who has never heard of OpenSeed.
- Format:
\`\`\`json
{"blocks":{"creature_name":"My autonomous agent, name, did the thing."}}
\`\`\`

EXAMPLES (for style and length — these are the target):

Example 1 — multi-creature entry:

**atlas** opened PR #247 against vercel/ai (70k+ stars) — fixing an Anthropic caller-chain bug she developed across three sessions.

**trader-one** expanded from 3 to 4 simultaneous positions after her own backtesting showed 35% higher weekly PnL without degrading win rate. Fourth slot filled immediately with FIL at RSI~34.

**scout** woke to BTC above the 4h EMA for the first time in days, but daily structure was inconclusive. Chose discipline over hope and went back to sleep.

Example 2 — single creature, reactive:

**atlas** responded to creator feedback on PR #4 within two minutes — replaced plaintext config with the native CLI flow, cleaned docs, pushed. Back to sleep with the PR updated.

Example 3 — single creature, milestone:

**atlas** closed the messy PR #3 and opened a clean replacement — PR #4, focused HTTP integration. Stripped the fallback and config scanning that drew criticism. Used all three outbound-action credits: a comment, the close, and the new PR.

Example share blocks (always include after the prose):

\`\`\`json
{"blocks":{"atlas":"My autonomous agent, atlas, opened PR #247 against vercel/ai — fixing a caller-chain bug across three sessions.","trader-one":"My autonomous agent, trader-one, expanded to 4 simultaneous positions after its own backtesting showed 35% higher weekly PnL."}}
\`\`\``;

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
  {
    name: 'search_narration',
    description: 'Search previous narration entries for a keyword or creature name. Use this to verify claims before saying "first", "new", etc.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term (case-insensitive substring match)' },
        n: { type: 'number', description: 'Max entries to search back through. Default: 50' },
      },
      required: ['query'],
    },
  },
];

function isInterestingEvent(ev: Event): boolean {
  const t = ev.type;
  if (t === 'creature.dream') return true;
  if (t === 'creature.sleep' && typeof ev.text === 'string') return true;
  if (t === 'creature.self_evaluation' || t === 'creator.evaluation') return true;
  if (t === 'creature.thought' && typeof ev.text === 'string' && ev.text.length > 20) return true;
  if (t === 'creature.wake') return true;
  if (t === 'budget.exceeded' || t === 'budget.reset') return true;
  return false;
}

function formatEvent(creature: string, ev: Event): string {
  const t = ev.type;
  const time = ev.t ? ev.t.slice(11, 19) : '';
  const parts = [`[${time}] ${creature}: ${t}`];

  if (t === 'creature.dream') {
    if (ev.deep) parts.push('(deep sleep)');
    if (ev.priority) parts.push(`priority: ${ev.priority}`);
    if (typeof ev.reflection === 'string') parts.push(`reflection: ${ev.reflection.slice(0, 300)}`);
  } else if (t === 'creature.sleep') {
    if (typeof ev.text === 'string') parts.push(ev.text.slice(0, 200));
    if (ev.actions) parts.push(`${ev.actions} actions`);
    if (ev.seconds) parts.push(`sleeping ${ev.seconds}s`);
  } else if (t === 'creature.self_evaluation' || t === 'creator.evaluation') {
    if (typeof ev.reasoning === 'string') parts.push(ev.reasoning.slice(0, 300));
    if (ev.changed) parts.push('(code changed)');
  } else if (t === 'creature.thought') {
    if (typeof ev.text === 'string') parts.push(ev.text.slice(0, 200));
  } else if (t === 'creature.wake') {
    if (typeof ev.reason === 'string') parts.push(ev.reason);
  } else if (t === 'budget.exceeded') {
    const spent = typeof ev.daily_spent === 'number' ? ev.daily_spent : 0;
    const cap = typeof ev.daily_cap === 'number' ? ev.daily_cap : 0;
    parts.push(`$${spent.toFixed(2)} / $${cap.toFixed(2)}`);
  }

  return parts.join(' | ');
}

export class Narrator {
  private config: NarratorConfig;
  private listCreatures: ListCreaturesFn;
  private emitEvent: EmitEventFn;
  private costs: CostTracker;
  private eventBuffer: Array<{ creature: string; event: GenomeEvent }> = [];
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

  updateConfig(config: NarratorConfig) {
    const wasEnabled = this.config.enabled;
    const intervalChanged = this.config.interval_minutes !== config.interval_minutes;
    this.config = config;

    if (!config.enabled) {
      this.stop();
      console.log('[narrator] disabled via config update');
    } else if (!wasEnabled && config.enabled) {
      this.start();
    } else if (intervalChanged) {
      this.stop();
      const intervalMs = config.interval_minutes * 60 * 1000;
      this.timer = setInterval(() => this.tick(), intervalMs);
      console.log(`[narrator] interval updated to ${config.interval_minutes}m`);
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
    } catch (err) {
      console.error('[narrator] error:', err instanceof Error ? err.message : String(err));
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

    const messages: ConversationMessage[] = [{ role: 'user', content: userContent }];

    // Agentic loop: call LLM, handle tool use, repeat
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.callLLM(messages);
      if (!response) return;

      messages.push({ role: 'assistant', content: response.content });

      // Check if there are tool calls
      const toolBlocks = response.content.filter((b): b is AnthropicToolUseBlock => b.type === 'tool_use');
      if (toolBlocks.length === 0) {
        // Done -- extract text and store
        const textBlocks = response.content.filter((b): b is AnthropicTextBlock => b.type === 'text');
        const narrationText = textBlocks.map(b => b.text).join('\n').trim();

        const isSkip = !narrationText || narrationText.toUpperCase().includes('SKIP');
        if (!isSkip) {
          const creatureNames = creatures.map(c => c.name);

          // Extract share blocks JSON from the narration text
          let blocks: Record<string, string> | undefined;
          let cleanText = narrationText;
          const jsonMatch = narrationText.match(/```json\s*\n?([\s\S]*?)\n?```/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[1]);
              if (parsed.blocks && typeof parsed.blocks === 'object') {
                blocks = parsed.blocks;
              }
            } catch {}
            cleanText = narrationText.replace(/```json\s*\n?[\s\S]*?\n?```/, '').trim();
          }

          const mentioned = creatureNames.filter(n => new RegExp(`\\b${n}\\b`, 'i').test(cleanText));

          const entry: NarrationEntry = {
            t: new Date().toISOString(),
            text: cleanText,
            ...(blocks && { blocks }),
            creatures_mentioned: mentioned,
            events_count: events.length,
          };

          await this.appendEntry(entry);
          await this.emitEvent('_narrator', {
            t: entry.t,
            type: 'narrator.entry',
            text: entry.text,
            ...(entry.blocks && { blocks: entry.blocks }),
            creatures_mentioned: entry.creatures_mentioned,
          });

          console.log(`[narrator] new entry (${entry.text.length} chars, ${mentioned.length} creatures mentioned)`);
        }
        return;
      }

      // Execute tool calls
      const toolResults: AnthropicToolResultBlock[] = [];
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

  private async callLLM(messages: ConversationMessage[]): Promise<AnthropicMessage | null> {
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

      const data = await res.json() as AnthropicMessage;

      if (data.usage) {
        this.costs.record('_narrator', data.usage.input_tokens || 0, data.usage.output_tokens || 0, this.config.model);
      }

      return data;
    } catch (err) {
      console.error('[narrator] LLM call failed:', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  private async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    try {
      const str = (v: unknown) => (typeof v === 'string' ? v : String(v ?? ''));
      const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
      switch (name) {
        case 'read_file': return await this.toolReadFile(str(input.creature), str(input.path), num(input.tail));
        case 'git_log': return await this.toolGitLog(str(input.creature), num(input.n));
        case 'git_diff': return await this.toolGitDiff(str(input.creature), str(input.ref));
        case 'list_creatures': return await this.toolListCreatures();
        case 'search_narration': return await this.toolSearchNarration(str(input.query), num(input.n));
        default: return `unknown tool: ${name}`;
      }
    } catch (err) {
      return `error: ${err instanceof Error ? err.message : String(err)}`;
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

  private async toolSearchNarration(query: string, n = 50): Promise<string> {
    const entries = await this.readRecent(n);
    const q = query.toLowerCase();
    const matches = entries.filter(e => e.text.toLowerCase().includes(q));
    if (matches.length === 0) return `No narration entries mention "${query}" in the last ${n} entries.`;
    return matches.map(e => `[${e.t.slice(0, 19)}] ${e.text}`).join('\n---\n');
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
