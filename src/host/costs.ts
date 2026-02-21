import {
  readFileSync,
  writeFileSync,
} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OPENSEED_HOME = process.env.OPENSEED_HOME || process.env.ITSALIVE_HOME || path.join(os.homedir(), '.openseed');
const USAGE_FILE = path.join(OPENSEED_HOME, 'usage.json');

const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-opus-4-6':   { input: 5 / 1e6,    output: 25 / 1e6 },
  'claude-sonnet-4-6': { input: 3 / 1e6,    output: 15 / 1e6 },
  'claude-haiku-4-5':  { input: 1 / 1e6,    output: 5 / 1e6 },
  // OpenAI GPT
  'gpt-5.2':           { input: 1.75 / 1e6, output: 14 / 1e6 },
  'gpt-5.1':           { input: 1.25 / 1e6, output: 10 / 1e6 },
  'gpt-5':             { input: 1.25 / 1e6, output: 10 / 1e6 },
  'gpt-5-mini':        { input: 0.25 / 1e6, output: 2 / 1e6 },
  'gpt-5-nano':        { input: 0.05 / 1e6, output: 0.4 / 1e6 },
  'gpt-4o':            { input: 2.5 / 1e6,  output: 10 / 1e6 },
  'gpt-4o-mini':       { input: 0.15 / 1e6, output: 0.6 / 1e6 },
  'gpt-4.1':           { input: 2 / 1e6,    output: 8 / 1e6 },
  'gpt-4.1-mini':      { input: 0.4 / 1e6,  output: 1.6 / 1e6 },
  'gpt-4.1-nano':      { input: 0.1 / 1e6,  output: 0.4 / 1e6 },
  // OpenAI reasoning
  'o4-mini':           { input: 1.1 / 1e6,  output: 4.4 / 1e6 },
  'o3-mini':           { input: 1.1 / 1e6,  output: 4.4 / 1e6 },
  'o3':                { input: 2 / 1e6,    output: 8 / 1e6 },
};
const DEFAULT_PRICING = PRICING['claude-opus-4-6'];

export interface UsageEntry {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  calls: number;
  daily_cost_usd: number;
  daily_date: string | null;
}

export class CostTracker {
  private usage: Map<string, UsageEntry> = new Map();
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.load();
    this.timer = setInterval(() => this.save(), 30_000);
    process.on('exit', () => this.saveSync());
    process.on('SIGINT', () => { this.saveSync(); process.exit(0); });
    process.on('SIGTERM', () => { this.saveSync(); process.exit(0); });
  }

  record(name: string, inputTokens: number, outputTokens: number, model?: string) {
    const entry = this.usage.get(name) || { input_tokens: 0, output_tokens: 0, cost_usd: 0, calls: 0, daily_cost_usd: 0, daily_date: null };
    const p = (model && PRICING[model]) || DEFAULT_PRICING;
    const callCost = inputTokens * p.input + outputTokens * p.output;
    entry.input_tokens += inputTokens;
    entry.output_tokens += outputTokens;
    entry.cost_usd += callCost;
    entry.calls += 1;

    const today = new Date().toISOString().slice(0, 10);
    if (entry.daily_date !== today) {
      entry.daily_cost_usd = 0;
      entry.daily_date = today;
    }
    entry.daily_cost_usd += callCost;

    this.usage.set(name, entry);
    this.dirty = true;
  }

  get(name: string): UsageEntry {
    return this.usage.get(name) || { input_tokens: 0, output_tokens: 0, cost_usd: 0, calls: 0, daily_cost_usd: 0, daily_date: null };
  }

  getCreatureDailyCost(name: string): number {
    const today = new Date().toISOString().slice(0, 10);
    const entry = this.usage.get(name);
    if (!entry || entry.daily_date !== today) return 0;
    return entry.daily_cost_usd;
  }

  getAll(): Record<string, UsageEntry> {
    const result: Record<string, UsageEntry> = {};
    for (const [k, v] of this.usage) result[k] = { ...v };
    return result;
  }

  getCreatureCost(name: string): number {
    let total = 0;
    for (const [key, entry] of this.usage) {
      if (key === name || key.endsWith(`:${name}`)) total += entry.cost_usd;
    }
    return total;
  }

  getTotal(): number {
    let total = 0;
    for (const v of this.usage.values()) total += v.cost_usd;
    return total;
  }

  private load() {
    try {
      const data = JSON.parse(readFileSync(USAGE_FILE, 'utf-8'));
      for (const [k, v] of Object.entries(data)) {
        this.usage.set(k, v as UsageEntry);
      }
      console.log(`[costs] loaded usage data (${this.usage.size} entries)`);
    } catch {
      // No file yet, start fresh
    }
  }

  async save() {
    if (!this.dirty) return;
    try {
      const data = Object.fromEntries(this.usage);
      await fs.writeFile(USAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
      this.dirty = false;
    } catch (err) {
      console.error('[costs] failed to save:', err);
    }
  }

  private saveSync() {
    if (!this.dirty) return;
    try {
      const data = Object.fromEntries(this.usage);
      writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
      this.dirty = false;
    } catch {}
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.saveSync();
  }
}
