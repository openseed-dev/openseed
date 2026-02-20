import { signal, computed } from '@preact/signals';
import type { CreatureInfo, CreatureEvent, BudgetInfo, GlobalBudget, NarrationEntry, MindData, GenomeInfo } from './types';
import * as api from './api';

// Core state
export const creatures = signal<Record<string, CreatureInfo>>({});
export const selected = signal<string | null>(null);
export const selectedTab = signal('log');
export const mindData = signal<MindData | null>(null);

// Narration
export const narrationEntries = signal<NarrationEntry[]>([]);
export const narrationDisplayCount = signal(5);

// Overview moments
export const allMoments = signal<CreatureEvent[]>([]);
export const showMoments = signal(false);

// Sidebar visibility (auto-managed: hidden on overview, visible on creature detail)
export const sidebarOpen = signal(false);

// Budget
export const creatureBudgets = signal<Record<string, BudgetInfo>>({});
export const globalBudget = signal<GlobalBudget | null>(null);

// Usage
export const usageData = signal<Record<string, { cost_usd?: number; daily_date?: string; daily_cost_usd?: number }>>({});
export const totalCost = signal(0);

// Genomes
export const genomes = signal<GenomeInfo[]>([]);

// Last known intents per creature (for sidebar tooltips etc.)
export const lastIntentMap = signal<Record<string, string>>({});

// Creature events (for detail view)
export const creatureEvents = signal<CreatureEvent[]>([]);

// Derived
export const creatureNames = computed(() => Object.keys(creatures.value).sort());

export function isInterestingEvent(ev: CreatureEvent): boolean {
  const t = ev.type;
  if (t === 'creature.dream') return true;
  if (t === 'creature.sleep' && ev.text) return true;
  if (t === 'creature.self_evaluation' || t === 'creator.evaluation') return true;
  if (t === 'creature.thought' && ev.text && ev.text.length > 20) return true;
  if (t === 'creature.wake') return true;
  if (t === 'budget.exceeded' || t === 'budget.reset') return true;
  return false;
}

export async function refresh() {
  try {
    const [crList, usageRes] = await Promise.all([
      api.fetchCreatures(),
      api.fetchUsage(),
    ]);
    const crMap: Record<string, CreatureInfo> = {};
    for (const c of crList) crMap[c.name] = c;
    creatures.value = crMap;

    usageData.value = usageRes.usage || {};
    totalCost.value = usageRes.total || 0;

    const names = Object.keys(crMap);
    const budgetResults = await Promise.all(
      names.map(n => api.fetchCreatureBudget(n).catch(() => null))
    );
    const budgets: Record<string, BudgetInfo> = {};
    names.forEach((n, i) => { if (budgetResults[i]) budgets[n] = budgetResults[i]!; });
    creatureBudgets.value = budgets;
  } catch {}
}

export async function loadNarration() {
  try {
    const entries = await api.fetchNarration(50);
    entries.reverse();
    narrationEntries.value = entries;
  } catch {
    narrationEntries.value = [];
  }
}

export async function loadRecentEvents() {
  const names = Object.keys(creatures.value);
  try {
    const results = await Promise.all(
      names.map(n => api.fetchCreatureEvents(n).catch(() => []))
    );
    let moments: CreatureEvent[] = [];
    results.forEach((events, i) => {
      events.slice(-30).forEach(ev => {
        ev.creature = ev.creature || names[i];
        if (isInterestingEvent(ev)) moments.push(ev);
      });
    });
    moments.sort((a, b) => (b.t || '').localeCompare(a.t || ''));
    allMoments.value = moments.slice(0, 60);
  } catch {}
}

export async function loadMind() {
  const name = selected.value;
  if (!name) return;
  try {
    mindData.value = await api.fetchCreatureFiles(name);
  } catch {
    mindData.value = {};
  }
}

export async function loadGlobalBudget() {
  try {
    globalBudget.value = await api.fetchGlobalBudget();
  } catch {}
}

export async function loadGenomes() {
  try {
    genomes.value = await api.fetchGenomes();
  } catch {}
}

export async function selectCreature(name: string | null) {
  selected.value = name;
  selectedTab.value = 'log';
  mindData.value = null;
  creatureEvents.value = [];
  if (name) sidebarOpen.value = false;

  if (name) {
    try {
      const [events, budget] = await Promise.all([
        api.fetchCreatureEvents(name),
        api.fetchCreatureBudget(name),
      ]);
      creatureEvents.value = events;
      creatureBudgets.value = { ...creatureBudgets.value, [name]: budget };
    } catch {}
    loadMind();
  }
}

export function handleSSEEvent(ev: CreatureEvent) {
  if (ev.creature) {
    const intents = { ...lastIntentMap.value };
    if (ev.type === 'creature.sleep' && ev.text) {
      intents[ev.creature] = ev.text.length > 100 ? ev.text.slice(0, 100) + '...' : ev.text;
    } else if (ev.type === 'creature.thought' && ev.text) {
      intents[ev.creature] = ev.text.length > 100 ? ev.text.slice(0, 100) + '...' : ev.text;
    } else if (ev.type === 'creature.dream') {
      intents[ev.creature] = (ev.deep ? 'deep sleep: ' : 'dreaming: ') + (ev.priority || '').slice(0, 80);
    } else if (ev.type === 'creature.tool_call') {
      const cmd = (ev.input || '').split('\n')[0];
      intents[ev.creature] = '\u25b6 ' + (cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd);
    }
    lastIntentMap.value = intents;
  }

  if (selected.value === null) {
    if (ev.type === 'narrator.entry') {
      const entry: NarrationEntry = {
        t: ev.t!,
        text: ev.text!,
        blocks: ev.blocks || null,
        creatures_mentioned: ev.creatures_mentioned || [],
      };
      narrationEntries.value = [entry, ...narrationEntries.value];
      return;
    }
    if (isInterestingEvent(ev)) {
      allMoments.value = [ev, ...allMoments.value.slice(0, 59)];
    }
    return;
  }

  if (selectedTab.value !== 'log') return;
  if (ev.creature !== selected.value) return;
  creatureEvents.value = [...creatureEvents.value, ev];
}
