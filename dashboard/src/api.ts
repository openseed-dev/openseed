import type { CreatureInfo, CreatureEvent, BudgetInfo, GlobalBudget, NarratorConfig, NarrationEntry, MindData, GenomeInfo, UsageData, OrchestratorHealth } from './types';

async function requireOk(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res;
}

export async function fetchCreatures(): Promise<CreatureInfo[]> {
  const res = await fetch('/api/creatures').then(requireOk);
  return res.json();
}

export async function fetchCreatureEvents(name: string): Promise<CreatureEvent[]> {
  const res = await fetch(`/api/creatures/${name}/events`).then(requireOk);
  return res.json();
}

export async function fetchCreatureBudget(name: string): Promise<BudgetInfo> {
  const res = await fetch(`/api/creatures/${name}/budget`).then(requireOk);
  return res.json();
}

export async function updateCreatureBudget(name: string, daily_usd: number, action: string): Promise<BudgetInfo> {
  const res = await fetch(`/api/creatures/${name}/budget`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daily_usd, action }),
  }).then(requireOk);
  return res.json();
}

export async function fetchCreatureFiles(name: string): Promise<MindData> {
  const res = await fetch(`/api/creatures/${name}/files`).then(requireOk);
  return res.json();
}

export async function fetchUsage(): Promise<UsageData> {
  const res = await fetch('/api/usage').then(requireOk);
  return res.json();
}

export async function fetchGlobalBudget(): Promise<GlobalBudget> {
  const res = await fetch('/api/budget').then(requireOk);
  return res.json();
}

export async function updateGlobalBudget(daily_usd: number, action: string): Promise<GlobalBudget> {
  const res = await fetch('/api/budget', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daily_usd, action }),
  }).then(requireOk);
  return res.json();
}

export async function fetchNarratorConfig(): Promise<NarratorConfig> {
  const res = await fetch('/api/narrator/config').then(requireOk);
  return res.json();
}

export async function updateNarratorConfig(config: Partial<NarratorConfig>): Promise<NarratorConfig> {
  const res = await fetch('/api/narrator/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  }).then(requireOk);
  return res.json();
}

export async function fetchNarration(limit = 50): Promise<NarrationEntry[]> {
  const res = await fetch(`/api/narration?limit=${limit}`).then(requireOk);
  return res.json();
}

export async function fetchGenomes(): Promise<GenomeInfo[]> {
  const res = await fetch('/api/genomes').then(requireOk);
  return res.json();
}

export async function creatureAction(name: string, action: 'start' | 'stop' | 'restart' | 'rebuild' | 'remount' | 'wake' | 'archive', method = 'POST'): Promise<void> {
  await fetch(`/api/creatures/${name}/${action}`, { method }).then(requireOk);
}

export async function sendMessage(name: string, text: string): Promise<void> {
  await fetch(`/api/creatures/${name}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then(requireOk);
}

export async function fetchStatus(): Promise<OrchestratorHealth> {
  const res = await fetch('/api/status').then(requireOk);
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

export async function fetchJaneeConfig(): Promise<import('./types').JaneeConfigView> {
  const res = await fetch('/api/janee/config');
  if (!res.ok) return { available: false, services: [], capabilities: [], agents: [] };
  return res.json();
}
