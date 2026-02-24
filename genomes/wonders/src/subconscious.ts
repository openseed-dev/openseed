import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';

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

export class Subconscious {
  async run(messages: ModelMessage[]): Promise<string | null> {
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
        matches: h.matches.map(m => m.slice(0, 200)),
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
- "wonder": a statement starting with "I wonder if I..." about what past experience might matter
- "query": a SHORT search term (1-3 words) that would literally appear in a JSONL event log of the agent's past tool calls and thoughts. Not a keyword list — a specific term or short phrase that grep would match.

The event log has entries like: {"type":"creature.tool_call","tool":"bash","input":"...","output":"..."} and {"type":"creature.thought","text":"..."}

Examples — if the agent is debugging a failing API call:

[
  {"wonder": "I wonder if I've hit this API error before", "query": "status 429"},
  {"wonder": "I wonder if my creator told me something about rate limits", "query": "rate limit"},
  {"wonder": "I wonder if I found a workaround last time something timed out", "query": "timeout"}
]

If the agent is writing a new script:

[
  {"wonder": "I wonder if I've written something similar before", "query": "#!/bin/bash"},
  {"wonder": "I wonder if I learned something about permissions the hard way", "query": "permission denied"},
  {"wonder": "I wonder if there's a tool I installed that could help", "query": "pip install"}
]

If the agent is researching a topic:

[
  {"wonder": "I wonder if I've looked into this before", "query": "cryptocurrency"},
  {"wonder": "I wonder if I bookmarked any useful sources", "query": "saved to"},
  {"wonder": "I wonder if my creator gave me guidance on this", "query": "creator"}
]

If the agent is planning its next steps:

[
  {"wonder": "I wonder what I was working on before I slept", "query": "set_sleep"},
  {"wonder": "I wonder if I've set goals for myself before", "query": "TODO"},
  {"wonder": "I wonder if I tried this approach and it failed", "query": "didn't work"}
]

Notice: queries are short, literal strings that grep can match in log lines. Not descriptions or keyword lists.

Respond with ONLY a JSON array.`,
        messages: [{ role: 'user', content: `Recent activity:\n\n${context.slice(0, 3000)}` }],
      });

      const parsed = JSON.parse(result.text);
      return Array.isArray(parsed) ? parsed.filter((w: any) => w.wonder && w.query).slice(0, 5) : [];
    } catch {
      return [];
    }
  }

  private search(wonders: Wonder[]): Array<{ wonder: Wonder; matches: string[] }> {
    const results: Array<{ wonder: Wonder; matches: string[] }> = [];

    for (const w of wonders) {
      try {
        const output = execFileSync('rg', [
          '-i', '-C', '1', '-m', '10', '--', w.query, EVENTS_FILE,
        ], { encoding: 'utf-8', timeout: 5000 });

        const matches = output.trim().split('\n--\n').filter(Boolean);
        if (matches.length > 0) {
          results.push({ wonder: w, matches: matches.slice(0, 5) });
        }
      } catch {
        // rg exits 1 for no matches
      }
    }

    return results;
  }

  private async prepare(
    messages: ModelMessage[],
    hits: Array<{ wonder: Wonder; matches: string[] }>,
  ): Promise<string | null> {
    const context = messages.slice(-3).map(m => {
      if (typeof m.content === 'string') return m.content;
      return JSON.stringify(m.content);
    }).join('\n---\n');

    const hitsSummary = hits.map(h =>
      `Hypothesis: "${h.wonder.wonder}"\nMatches:\n${h.matches.join('\n---\n')}`
    ).join('\n\n===\n\n');

    try {
      const result = await generateText({
        model: provider(FAST_MODEL),
        maxOutputTokens: 300,
        system: `You curate memories for an agent. You see what it's doing now and memories that matched search queries.

Decide: are any of these memories genuinely useful right now? Not just vaguely related — actually helpful for what the agent is doing.

If yes: frame it as a brief thought (1-3 sentences) as if the agent is remembering something relevant.
If no: respond with exactly NOTHING

Be tolerant of "maybe relevant" — surfacing something uncertain is fine. But don't surface pure noise or keyword coincidences.`,
        messages: [{
          role: 'user',
          content: `Current activity:\n${context.slice(0, 2000)}\n\nMemories found:\n${hitsSummary.slice(0, 3000)}`,
        }],
      });

      const text = result.text.trim();
      if (text === 'NOTHING' || text.length < 10) return null;
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
