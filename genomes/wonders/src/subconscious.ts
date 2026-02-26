import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';

import { generateText, type ModelMessage } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

const EVENTS_FILE = '.sys/events.jsonl';
const LOG_FILE = '.sys/subconscious.jsonl';
const FAST_MODEL = process.env.SUBCONSCIOUS_MODEL || 'claude-sonnet-4-20250514';

const provider = createAnthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL
    ? `${process.env.ANTHROPIC_BASE_URL}/v1`
    : undefined,
});

interface Wonder {
  wonder: string;
  query: string;
}

interface AnnotatedMatch {
  text: string;
  age: number | null;
  ageLabel: string;
}

function formatAge(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} seconds ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minutes ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs} hours ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

function extractTimestamp(line: string): Date | null {
  const m = line.match(/"t"\s*:\s*"([^"]+)"/);
  return m ? new Date(m[1]) : null;
}

export class Subconscious {
  private cycleStartedAt: Date | null = null;
  private usedQueries: Set<string> = new Set();

  setCycleStart(t: Date) {
    this.cycleStartedAt = t;
    this.usedQueries = new Set();
  }

  async run(messages: ModelMessage[]): Promise<string | null> {
    // No past events to search — first cycle or no cutoff
    if (this.cycleStartedAt && !this.hasPastEvents()) {
      this.log({ step: 'skip', reason: 'no_past_events' });
      return null;
    }

    const wonders = await this.wonder(messages);
    if (wonders.length === 0) {
      this.log({ step: 'wonder', wonders: [], result: 'no_hypotheses' });
      return null;
    }

    this.log({
      step: 'wonder',
      wonders: wonders.map(w => ({ wonder: w.wonder, query: w.query })),
    });

    const hits = this.search(wonders);

    this.log({
      step: 'search',
      queries: wonders.map(w => w.query),
      hits: hits.map(h => ({
        query: h.wonder.query,
        wonder: h.wonder.wonder,
        matchCount: h.matches.length,
        matches: h.matches.map(m => m.text.slice(0, 200)),
      })),
      missedQueries: wonders.filter(w => !hits.some(h => h.wonder.query === w.query)).map(w => w.query),
    });

    if (hits.length === 0) return null;

    const surfaced = await this.prepare(messages, hits);

    this.log({
      step: 'prepare',
      candidateCount: hits.reduce((n, h) => n + h.matches.length, 0),
      surfaced: surfaced ?? null,
    });

    return surfaced;
  }

  private hasPastEvents(): boolean {
    try {
      const first = readFileSync(EVENTS_FILE, 'utf-8').split('\n')[0];
      if (!first) return false;
      const ts = extractTimestamp(first);
      return ts !== null && ts < this.cycleStartedAt!;
    } catch {
      return false;
    }
  }

  private async wonder(messages: ModelMessage[]): Promise<Wonder[]> {
    const context = messages.slice(-4).map(m => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return (m.content as any[]).map(c => c.text || c.value || '').join('\n');
      }
      return '';
    }).join('\n---\n');

    try {
      const result = await generateText({
        model: provider(FAST_MODEL),
        maxOutputTokens: 400,
        system: `You are a subconscious memory retrieval process. You observe what an agent is currently doing and generate hypotheses about what past experiences might be relevant.

Generate 3 hypotheses as a JSON array. Each object has:
- "wonder": a statement starting with "I wonder if I..." about what past experience might matter NOW
- "query": a SHORT search term (1-3 words) that would literally appear in a JSONL event log of the agent's past tool calls and thoughts. Not a keyword list — a specific term or short phrase that grep would match.

The event log has entries like:
- {"type":"creature.tool_call","tool":"bash","input":"...","output":"..."}
- {"type":"creature.thought","text":"..."}
- {"type":"creature.sleep","seconds":N}

IMPORTANT:
- Prioritize queries that surface PLANS, DECISIONS, and CONCLUSIONS from past cycles — not just exploration
- Vary queries across different domains — don't cluster on the same topic
- Think about what would change the agent's NEXT ACTION, not just what's vaguely related
- Good queries target: stated intentions ("want to", "next cycle", "plan"), outcomes ("accomplished", "completed", "failed"), errors ("error", "permission denied"), specific tools or files the agent is working with
- Bad queries are too generic: "bash", "ls", "mind.ts", "architecture" — these match noise

Examples — if the agent is debugging a failing API call:

[
  {"wonder": "I wonder if I've hit this API error before", "query": "status 429"},
  {"wonder": "I wonder if I found a workaround last time", "query": "rate limit"},
  {"wonder": "I wonder if I planned to handle this case", "query": "want to"}
]

If the agent is planning its next steps:

[
  {"wonder": "I wonder what I planned to do next", "query": "next cycle"},
  {"wonder": "I wonder what I accomplished last cycle", "query": "accomplished"},
  {"wonder": "I wonder if I tried this approach and it failed", "query": "didn't work"}
]

Respond with ONLY a JSON array.`,
        messages: [{ role: 'user', content: `Recent activity:\n\n${context.slice(0, 3000)}` }],
      });

      const parsed = JSON.parse(result.text);
      return Array.isArray(parsed) ? parsed.filter((w: any) => w.wonder && w.query).slice(0, 5) : [];
    } catch {
      return [];
    }
  }

  private search(wonders: Wonder[]): Array<{ wonder: Wonder; matches: AnnotatedMatch[] }> {
    const now = Date.now();
    const cutoff = this.cycleStartedAt?.getTime() ?? now;
    const results: Array<{ wonder: Wonder; matches: AnnotatedMatch[] }> = [];

    for (const w of wonders) {
      const qKey = w.query.toLowerCase();
      if (this.usedQueries.has(qKey)) continue;
      this.usedQueries.add(qKey);

      const matches: AnnotatedMatch[] = [];

      try {
        const output = execFileSync('rg', [
          '-i', '-m', '30', '--', w.query, EVENTS_FILE,
        ], { encoding: 'utf-8', timeout: 5000 });

        for (const line of output.trim().split('\n').filter(Boolean)) {
          if (!line.includes('"creature.thought"')) continue;
          const ts = extractTimestamp(line);
          if (ts && ts.getTime() >= cutoff) continue;
          const age = ts ? now - ts.getTime() : null;
          const thought = this.extractThoughtText(line);
          if (!thought) continue;
          matches.push({ text: thought, age, ageLabel: age !== null ? formatAge(age) : 'unknown time ago' });
          if (matches.length >= 5) break;
        }
      } catch {}

      if (matches.length > 0) {
        results.push({ wonder: w, matches });
      }
    }

    return results;
  }

  private extractThoughtText(line: string): string | null {
    try {
      const obj = JSON.parse(line);
      return obj.text || null;
    } catch {
      const m = line.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      return m ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : null;
    }
  }

  private async prepare(
    messages: ModelMessage[],
    hits: Array<{ wonder: Wonder; matches: AnnotatedMatch[] }>,
  ): Promise<string | null> {
    const context = messages.slice(-3).map(m => {
      if (typeof m.content === 'string') return m.content;
      return JSON.stringify(m.content);
    }).join('\n---\n');

    const hitsSummary = hits.map(h =>
      `Hypothesis: "${h.wonder.wonder}"\nMatches:\n${h.matches.map(m => `(${m.ageLabel}) ${m.text}`).join('\n---\n')}`
    ).join('\n\n===\n\n');

    try {
      const result = await generateText({
        model: provider(FAST_MODEL),
        maxOutputTokens: 400,
        system: `You are a memory curator. You must decide: is there ONE memory here worth surfacing? The default is NOTHING.

You see what the agent is doing now and candidate memories from past cycles (annotated with age).

SURFACE AT MOST ONE MEMORY. Pick the single most valuable, or surface nothing.

What makes a memory worth surfacing (ranked):

1. LATERAL ASSOCIATION (highest value): A memory from a DIFFERENT situation that reveals a transferable pattern — "last time a similar dynamic played out, here's what happened." Connections the agent wouldn't make on its own.

2. NOVELTY: Does the agent already know this? If the information is anywhere in current context — even implied — it adds zero value.

3. RECENCY: Prefer recent memories over old ones, all else equal. But a genuinely lateral association from days ago beats a redundant recent one.

4. ACTIONABILITY: Would this CHANGE what the agent does next? Not "is this related" — would it cause a different decision? If not, surface NOTHING.

NEVER surface:
- Status of positions/trades the agent is already tracking
- Information the agent clearly already has (from files it reads, context it wrote)
- Confirmation of what the agent is already doing
- Market data that has since changed
- Anything that appeared in the last 2 cycles

Silence is better than noise. If you're unsure, say NOTHING. A bad memory erodes trust in the entire system.

If surfacing: 1-2 sentences, framed as a thought. Be precise about when.
If not: respond with exactly NOTHING`,
        messages: [{
          role: 'user',
          content: `Current activity:\n${context.slice(0, 2000)}\n\nCandidate memories:\n${hitsSummary.slice(0, 3000)}`,
        }],
      });

      const text = result.text.trim();
      if (text.includes('NOTHING') || text.length < 10) return null;
      return text;
    } catch {
      return null;
    }
  }

  private log(entry: Record<string, unknown>) {
    try {
      mkdirSync('.sys', { recursive: true });
      appendFileSync(LOG_FILE, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
    } catch {}
  }
}
