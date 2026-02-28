import { setDependency } from './health.js';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OPENSEED_HOME = process.env.OPENSEED_HOME || process.env.ITSALIVE_HOME || path.join(os.homedir(), '.openseed');
const USAGE_FILE = path.join(OPENSEED_HOME, 'usage.json');
const PRICING_CACHE_FILE = path.join(OPENSEED_HOME, 'litellm-pricing.json');
const LITELLM_PRICING_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const PRICING_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface LiteLLMEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  litellm_provider?: string;
  mode?: string;
}

// Loaded LiteLLM pricing data — populated at startup
let litellmPricing: Record<string, LiteLLMEntry> | null = null;

// No fallback pricing — LiteLLM data is a required dependency.
// The health system gates creature operations when pricing is unavailable.

/**
 * Load LiteLLM pricing from cache or fetch fresh.
 * Call once at startup. Pricing is a required dependency —
 * reports status via the health system.
 */
export async function initPricing(): Promise<void> {
  const now = () => new Date().toISOString();
  let freshFromCache = false;

  // Try loading from cache first
  try {
    if (existsSync(PRICING_CACHE_FILE)) {
      const stat = await fs.stat(PRICING_CACHE_FILE);
      const ageMs = Date.now() - stat.mtimeMs;
      const raw = await fs.readFile(PRICING_CACHE_FILE, 'utf-8');
      litellmPricing = JSON.parse(raw);
      freshFromCache = ageMs < PRICING_REFRESH_INTERVAL_MS;
    }
  } catch {
    // Cache read failed — will fetch
  }

  if (litellmPricing && freshFromCache) {
    const count = Object.keys(litellmPricing).length;
    setDependency('pricing', { status: 'up', lastCheck: now(), version: `${count} models (cached)` });
    return;
  }

  // Fetch fresh data
  const doFetch = async () => {
    try {
      const resp = await fetch(LITELLM_PRICING_URL, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as Record<string, LiteLLMEntry>;
      litellmPricing = data;
      if (!existsSync(OPENSEED_HOME)) mkdirSync(OPENSEED_HOME, { recursive: true });
      await fs.writeFile(PRICING_CACHE_FILE, JSON.stringify(data));
      const count = Object.keys(data).length;
      setDependency('pricing', { status: 'up', lastCheck: now(), version: `${count} models` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!litellmPricing) {
        setDependency('pricing', { status: 'down', lastCheck: now(), error: msg.slice(0, 200) });
      }
      // If we have stale cache, keep pricing 'up' but log warning
    }
  };

  if (litellmPricing) {
    // Have stale cache — mark up, refresh in background
    const count = Object.keys(litellmPricing).length;
    setDependency('pricing', { status: 'up', lastCheck: now(), version: `${count} models (stale cache, refreshing)` });
    doFetch();
  } else {
    // No cache — must fetch before continuing
    await doFetch();
  }
}

/**
 * Look up pricing for a model from LiteLLM data.
 * Tries exact match, then common prefixed variants (e.g. "gemini/model", "openrouter/provider/model").
 */
export function lookupPricing(model: string): { input: number; output: number } | null {
  if (!litellmPricing) return null;

  // Try exact match first
  const exact = litellmPricing[model];
  if (exact?.input_cost_per_token != null && exact?.output_cost_per_token != null) {
    return { input: exact.input_cost_per_token, output: exact.output_cost_per_token };
  }

  // Try common prefixed variants
  const prefixes = ['', 'gemini/', 'vertex_ai/', 'openrouter/', 'openai/', 'anthropic/'];
  for (const prefix of prefixes) {
    const key = prefix + model;
    const entry = litellmPricing[key];
    if (entry?.input_cost_per_token != null && entry?.output_cost_per_token != null) {
      return { input: entry.input_cost_per_token, output: entry.output_cost_per_token };
    }
  }

  // Try suffix match — find any key that ends with the model name
  for (const [key, entry] of Object.entries(litellmPricing)) {
    if (key.endsWith('/' + model) && entry?.input_cost_per_token != null && entry?.output_cost_per_token != null) {
      return { input: entry.input_cost_per_token, output: entry.output_cost_per_token };
    }
  }

  return null;
}

/**
 * Get pricing for a model from LiteLLM data.
 * Returns zero-cost if pricing data is unavailable (health system prevents this at startup).
 */
export function getPricing(model: string): { input: number; output: number } {
  const litellm = lookupPricing(model);
  if (litellm) return litellm;

  if (!litellmPricing) {
    console.warn(`[costs] pricing data not loaded — cost tracking disabled for model: ${model}`);
    return { input: 0, output: 0 };
  }

  console.warn(`[costs] unknown model pricing: ${model} — cost will not be tracked`);
  return { input: 0, output: 0 };
}

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
  private _onExit: (() => void) | null = null;
  private _onSigint: (() => void) | null = null;
  private _onSigterm: (() => void) | null = null;

  constructor() {
    this.load();
    this.timer = setInterval(() => this.save(), 30_000);
    this.timer.unref();
    this._onExit = () => this.saveSync();
    this._onSigint = () => { this.saveSync(); process.exit(0); };
    this._onSigterm = () => { this.saveSync(); process.exit(0); };
    process.on('exit', this._onExit);
    process.on('SIGINT', this._onSigint);
    process.on('SIGTERM', this._onSigterm);
  }

  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this._onExit) { process.removeListener('exit', this._onExit); this._onExit = null; }
    if (this._onSigint) { process.removeListener('SIGINT', this._onSigint); this._onSigint = null; }
    if (this._onSigterm) { process.removeListener('SIGTERM', this._onSigterm); this._onSigterm = null; }
  }

  record(name: string, inputTokens: number, outputTokens: number, model?: string) {
    const entry = this.usage.get(name) || { input_tokens: 0, output_tokens: 0, cost_usd: 0, calls: 0, daily_cost_usd: 0, daily_date: null };
    const p = model ? getPricing(model) : { input: 0, output: 0 };
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

  getTotal(): number {
    let total = 0;
    for (const v of this.usage.values()) total += v.cost_usd;
    return total;
  }

  getCreatureCost(name: string): number {
    let total = 0;
    for (const [key, entry] of this.usage) {
      if (key === name || key.endsWith(`:${name}`)) total += entry.cost_usd;
    }
    return total;
  }

  private load() {
    try {
      const raw = readFileSync(USAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      for (const [k, v] of Object.entries(data)) {
        this.usage.set(k, v as UsageEntry);
      }
    } catch {
      // No existing usage — start fresh
    }
  }

  save() {
    if (!this.dirty) return;
    this.saveSync();
  }

  private saveSync() {
    if (!this.dirty) return;
    try {
      if (!existsSync(OPENSEED_HOME)) mkdirSync(OPENSEED_HOME, { recursive: true });
      const obj: Record<string, UsageEntry> = {};
      for (const [k, v] of this.usage) obj[k] = v;
      writeFileSync(USAGE_FILE, JSON.stringify(obj, null, 2));
      this.dirty = false;
    } catch {
      // Can't save — will retry
    }
  }
}

/** @internal — for testing only. Injects mock pricing data. */
export function _setLitellmPricing(data: Record<string, LiteLLMEntry> | null): void {
  litellmPricing = data;
}
