import { create } from 'zustand';
import type { CreatureInfo, CreatureEvent, BudgetInfo, GlobalBudget, NarratorConfig, NarrationEntry, MindData, GenomeInfo, OrchestratorHealth } from './types';
import * as api from './api';

interface ShareData {
  name: string;
  summary: string;
  t: string;
}

interface AppState {
  creatures: Record<string, CreatureInfo>;
  selected: string | null;
  selectedTab: string;
  mindData: MindData | null;

  narrationEntries: NarrationEntry[];
  narrationDisplayCount: number;

  allMoments: CreatureEvent[];
  showMoments: boolean;

  sidebarOpen: boolean;
  settingsOpen: boolean;

  creatureBudgets: Record<string, BudgetInfo>;
  globalBudget: GlobalBudget | null;

  usageData: Record<string, { cost_usd?: number; daily_date?: string; daily_cost_usd?: number }>;
  totalCost: number;

  genomes: GenomeInfo[];
  lastIntentMap: Record<string, string>;
  creatureEvents: CreatureEvent[];
  narratorConfig: NarratorConfig | null;

  shareData: ShareData | null;

  health: OrchestratorHealth;
}

interface AppActions {
  refresh: () => Promise<void>;
  loadNarration: () => Promise<void>;
  loadRecentEvents: () => Promise<void>;
  loadMind: () => Promise<void>;
  loadGlobalBudget: () => Promise<void>;
  loadNarratorConfig: () => Promise<void>;
  loadGenomes: () => Promise<void>;
  loadHealth: () => Promise<void>;
  selectCreature: (name: string | null) => Promise<void>;
  handleSSEEvent: (ev: CreatureEvent) => void;
  setSelectedTab: (tab: string) => void;
  setNarrationDisplayCount: (n: number) => void;
  setShowMoments: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setShareData: (d: ShareData | null) => void;
}

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

export const useStore = create<AppState & AppActions>()((set, get) => ({
  creatures: {},
  selected: null,
  selectedTab: 'log',
  mindData: null,
  narrationEntries: [],
  narrationDisplayCount: 5,
  allMoments: [],
  showMoments: false,
  sidebarOpen: localStorage.getItem('sidebarOpen') === 'true',
  settingsOpen: false,
  creatureBudgets: {},
  globalBudget: null,
  usageData: {},
  totalCost: 0,
  genomes: [],
  lastIntentMap: {},
  creatureEvents: [],
  narratorConfig: null,
  shareData: null,
  health: { status: 'healthy', dependencies: {} },

  loadHealth: async () => {
    try {
      set({ health: await api.fetchStatus() });
    } catch {}
  },

  refresh: async () => {
    try {
      const [crList, usageRes] = await Promise.all([
        api.fetchCreatures(),
        api.fetchUsage(),
      ]);
      const crMap: Record<string, CreatureInfo> = {};
      for (const c of crList) crMap[c.name] = c;

      const names = Object.keys(crMap);
      const budgetResults = await Promise.all(
        names.map(n => api.fetchCreatureBudget(n).catch(() => null))
      );
      const budgets: Record<string, BudgetInfo> = {};
      names.forEach((n, i) => { if (budgetResults[i]) budgets[n] = budgetResults[i]!; });

      set({
        creatures: crMap,
        usageData: usageRes.usage || {},
        totalCost: usageRes.total || 0,
        creatureBudgets: budgets,
      });
    } catch {}
  },

  loadNarration: async () => {
    try {
      const entries = await api.fetchNarration(50);
      entries.reverse();
      set({ narrationEntries: entries });
    } catch {
      set({ narrationEntries: [] });
    }
  },

  loadRecentEvents: async () => {
    const names = Object.keys(get().creatures);
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
      set({ allMoments: moments.slice(0, 60) });
    } catch {}
  },

  loadMind: async () => {
    const name = get().selected;
    if (!name) return;
    try {
      set({ mindData: await api.fetchCreatureFiles(name) });
    } catch {
      set({ mindData: {} });
    }
  },

  loadGlobalBudget: async () => {
    try {
      set({ globalBudget: await api.fetchGlobalBudget() });
    } catch {}
  },

  loadNarratorConfig: async () => {
    try {
      set({ narratorConfig: await api.fetchNarratorConfig() });
    } catch {}
  },

  loadGenomes: async () => {
    try {
      set({ genomes: await api.fetchGenomes() });
    } catch {}
  },

  selectCreature: async (name) => {
    set({
      selected: name,
      selectedTab: 'log',
      mindData: null,
      creatureEvents: [],
      ...(name ? { sidebarOpen: false } : {}),
    });

    if (name) {
      try {
        const [events, budget] = await Promise.all([
          api.fetchCreatureEvents(name),
          api.fetchCreatureBudget(name),
        ]);
        set(s => ({
          creatureEvents: events,
          creatureBudgets: { ...s.creatureBudgets, [name]: budget },
        }));
      } catch {}
      get().loadMind();
    }
  },

  handleSSEEvent: (ev) => {
    const s = get();

    if (ev.type === 'orchestrator.status') {
      set({ health: { status: ev.status, dependencies: ev.dependencies } });
      return;
    }

    if (ev.creature) {
      const intents = { ...s.lastIntentMap };
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
      set({ lastIntentMap: intents });
    }

    if (ev.type === 'creature.spawning' || ev.type === 'creature.spawned' || ev.type === 'creature.spawn_failed'
      || ev.type === 'creature.started' || ev.type === 'creature.stopped'
      || ev.type === 'creature.sleep' || ev.type === 'creature.wake') {
      get().refresh();
    }

    if (s.selected === null) {
      if (ev.type === 'narrator.entry') {
        const entry: NarrationEntry = {
          t: ev.t!,
          text: ev.text!,
          blocks: ev.blocks || null,
          creatures_mentioned: ev.creatures_mentioned || [],
        };
        set(prev => ({ narrationEntries: [entry, ...prev.narrationEntries] }));
        return;
      }
      if (isInterestingEvent(ev)) {
        set(prev => ({ allMoments: [ev, ...prev.allMoments.slice(0, 59)] }));
      }
      return;
    }

    if (s.selectedTab !== 'log') return;
    if (ev.creature !== s.selected) return;
    set(prev => ({ creatureEvents: [...prev.creatureEvents, ev] }));
  },

  setSelectedTab: (tab) => {
    set({ selectedTab: tab });
    if (tab !== 'log') get().loadMind();
  },
  setNarrationDisplayCount: (n) => set({ narrationDisplayCount: n }),
  setShowMoments: (v) => set({ showMoments: v }),
  setSidebarOpen: (v) => { localStorage.setItem('sidebarOpen', String(v)); set({ sidebarOpen: v }); },
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setShareData: (d) => set({ shareData: d }),
}));
