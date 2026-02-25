import type { CreatureInfo, CreatureEvent, BudgetInfo, GlobalBudget, NarratorConfig, NarrationEntry, MindData, GenomeInfo, UsageData, OrchestratorHealth } from './types';

export async function fetchCreatures(): Promise<CreatureInfo[]> {
  const res = await fetch('/api/creatures');
  return res.json();
}

export async function fetchCreatureEvents(name: string): Promise<CreatureEvent[]> {
  const res = await fetch(`/api/creatures/${name}/events`);
  return res.json();
}

export async function fetchCreatureBudget(name: string): Promise<BudgetInfo> {
  const res = await fetch(`/api/creatures/${name}/budget`);
  return res.json();
}

export async function updateCreatureBudget(name: string, daily_usd: number, action: string): Promise<BudgetInfo> {
  const res = await fetch(`/api/creatures/${name}/budget`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daily_usd, action }),
  });
  return res.json();
}

export async function fetchCreatureFiles(name: string): Promise<MindData> {
  const res = await fetch(`/api/creatures/${name}/files`);
  return res.json();
}

export async function fetchUsage(): Promise<UsageData> {
  const res = await fetch('/api/usage');
  return res.json();
}

export async function fetchGlobalBudget(): Promise<GlobalBudget> {
  const res = await fetch('/api/budget');
  return res.json();
}

export async function updateGlobalBudget(daily_usd: number, action: string): Promise<GlobalBudget> {
  const res = await fetch('/api/budget', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daily_usd, action }),
  });
  return res.json();
}

export async function fetchNarratorConfig(): Promise<NarratorConfig> {
  const res = await fetch('/api/narrator/config');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function updateNarratorConfig(config: Partial<NarratorConfig>): Promise<NarratorConfig> {
  const res = await fetch('/api/narrator/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchNarration(limit = 50): Promise<NarrationEntry[]> {
  const res = await fetch(`/api/narration?limit=${limit}`);
  return res.json();
}

export async function fetchGenomes(): Promise<GenomeInfo[]> {
  const res = await fetch('/api/genomes');
  return res.json();
}

export async function creatureAction(name: string, action: 'start' | 'stop' | 'restart' | 'rebuild' | 'wake' | 'archive', method = 'POST'): Promise<void> {
  await fetch(`/api/creatures/${name}/${action}`, { method });
}

export async function sendMessage(name: string, text: string): Promise<void> {
  await fetch(`/api/creatures/${name}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export async function fetchStatus(): Promise<OrchestratorHealth> {
  const res = await fetch('/api/status');
  return res.json();
}

export async function spawnCreature(name: string, genome: string, purpose?: string, model?: string): Promise<Response> {
  const body: Record<string, string> = { name, genome };
  if (purpose) body.purpose = purpose;
  if (model) body.model = model;
  return fetch('/api/creatures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
