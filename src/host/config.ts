import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const OPENSEED_HOME = process.env.OPENSEED_HOME || process.env.ITSALIVE_HOME || path.join(process.env.HOME || '/tmp', '.openseed');
const CREATURES_DIR = path.join(OPENSEED_HOME, 'creatures');

export interface SpendingCapConfig {
  daily_usd: number;
  action: 'sleep' | 'warn' | 'off';
  creature_aware?: boolean;
}

export interface OpenSeedConfig {
  spending_cap: SpendingCapConfig;
}

const DEFAULTS: OpenSeedConfig = {
  spending_cap: {
    daily_usd: 20,
    action: 'sleep',
    creature_aware: false,
  },
};

function loadJsonSafe(filePath: string): Record<string, any> {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function mergeConfig(base: OpenSeedConfig, override: Record<string, any>): OpenSeedConfig {
  const cap = override.spending_cap || {};
  return {
    spending_cap: {
      daily_usd: cap.daily_usd ?? base.spending_cap.daily_usd,
      action: cap.action ?? base.spending_cap.action,
      creature_aware: cap.creature_aware ?? base.spending_cap.creature_aware,
    },
  };
}

export function loadGlobalConfig(): OpenSeedConfig {
  const raw = loadJsonSafe(path.join(OPENSEED_HOME, 'config.json'));
  return mergeConfig(DEFAULTS, raw);
}

export function loadCreatureConfig(name: string): OpenSeedConfig {
  const global = loadGlobalConfig();
  const raw = loadJsonSafe(path.join(CREATURES_DIR, name, 'config.json'));
  return mergeConfig(global, raw);
}

export function getSpendingCap(name: string): SpendingCapConfig {
  return loadCreatureConfig(name).spending_cap;
}

export function saveGlobalSpendingCap(cap: Partial<SpendingCapConfig>): void {
  const configPath = path.join(OPENSEED_HOME, 'config.json');
  const existing = loadJsonSafe(configPath);
  const merged = { ...existing, spending_cap: { ...(existing.spending_cap || {}), ...cap } };
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n');
}

export function saveCreatureSpendingCap(name: string, cap: Partial<SpendingCapConfig>): void {
  const configPath = path.join(CREATURES_DIR, name, 'config.json');
  const existing = loadJsonSafe(configPath);
  const merged = { ...existing, spending_cap: { ...(existing.spending_cap || {}), ...cap } };
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n');
}
