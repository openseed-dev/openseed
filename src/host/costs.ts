import fs from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const USAGE_FILE = path.join(os.homedir(), '.itsalive', 'usage.json');

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':   { input: 5 / 1e6,    output: 25 / 1e6 },
  'claude-sonnet-4-5': { input: 3 / 1e6,    output: 15 / 1e6 },
  'claude-haiku-4-5':  { input: 1 / 1e6,    output: 5 / 1e6 },
  'gpt-5.2':           { input: 1.75 / 1e6, output: 14 / 1e6 },
  'gpt-5-mini':        { input: 0.25 / 1e6, output: 2 / 1e6 },
  'o4-mini':           { input: 1.1 / 1e6,  output: 4.4 / 1e6 },
};
const DEFAULT_PRICING = PRICING['claude-opus-4-6'];

export interface UsageEntry {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  calls: number;
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
    const entry = this.usage.get(name) || { input_tokens: 0, output_tokens: 0, cost_usd: 0, calls: 0 };
    const p = (model && PRICING[model]) || DEFAULT_PRICING;
    entry.input_tokens += inputTokens;
    entry.output_tokens += outputTokens;
    entry.cost_usd += inputTokens * p.input + outputTokens * p.output;
    entry.calls += 1;
    this.usage.set(name, entry);
    this.dirty = true;
  }

  get(name: string): UsageEntry {
    return this.usage.get(name) || { input_tokens: 0, output_tokens: 0, cost_usd: 0, calls: 0 };
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
