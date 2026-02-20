import { useState } from 'preact/hooks';
import {
  creatures, selected, creatureBudgets, globalBudget, genomes, sidebarOpen,
  selectCreature, refresh, loadGlobalBudget,
} from '../state';
import { useValue } from '../hooks';
import * as api from '../api';
import { fmtCost } from '../utils';

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    stopped: 'bg-text-muted',
    starting: 'bg-warn',
    running: 'bg-alive',
    sleeping: 'bg-dormant',
    error: 'bg-error animate-[pulse-error_1s_ease-in-out_infinite]',
  };
  return <span class={`w-2 h-2 rounded-full shrink-0 ${colors[status] || 'bg-text-muted'}`} />;
}

function SpawnForm({ onClose }: { onClose: () => void }) {
  const genomeList = useValue(genomes);
  const [name, setName] = useState('');
  const [genome, setGenome] = useState('');
  const [model, setModel] = useState('');
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) { setError('name is required'); return; }
    setSubmitting(true);
    setError('');
    try {
      const res = await api.spawnCreature(
        name.trim(),
        genome || genomeList[0]?.name || 'minimal',
        purpose.trim() || undefined,
        model || undefined,
      );
      if (!res.ok) { setError(await res.text()); return; }
      onClose();
      await refresh();
      selectCreature(name.trim());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="p-3 border-b border-border-light bg-[#f5f5f5] flex flex-col gap-2">
      <input
        class="bg-white border border-[#d0d0d0] text-text-primary px-2 py-1.5 rounded text-xs font-sans focus:outline-none focus:border-accent"
        placeholder="name (lowercase)" maxLength={32}
        value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)}
      />
      <select
        class="bg-white border border-[#d0d0d0] text-text-primary px-2 py-1.5 rounded text-xs font-sans focus:outline-none focus:border-accent"
        value={genome} onChange={(e) => setGenome((e.target as HTMLSelectElement).value)}
      >
        {genomeList.map(g => <option value={g.name}>{g.name}</option>)}
      </select>
      <select
        class="bg-white border border-[#d0d0d0] text-text-primary px-2 py-1.5 rounded text-xs font-sans focus:outline-none focus:border-accent"
        value={model} onChange={(e) => setModel((e.target as HTMLSelectElement).value)}
      >
        <option value="">model (default: opus)</option>
        <option value="claude-opus-4-6">claude-opus-4-6 ($5/$25)</option>
        <option value="claude-sonnet-4-5">claude-sonnet-4-5 ($3/$15)</option>
        <option value="claude-haiku-4-5">claude-haiku-4-5 ($1/$5)</option>
        <option value="gpt-5.2">gpt-5.2 ($1.75/$14)</option>
        <option value="gpt-5-mini">gpt-5-mini ($0.25/$2)</option>
        <option value="o4-mini">o4-mini ($1.10/$4.40)</option>
      </select>
      <textarea
        class="bg-white border border-[#d0d0d0] text-text-primary px-2 py-1.5 rounded text-xs font-sans resize-y min-h-12 focus:outline-none focus:border-accent"
        placeholder="purpose (optional)" rows={3}
        value={purpose} onInput={(e) => setPurpose((e.target as HTMLTextAreaElement).value)}
      />
      <button
        class="bg-[#f0fdf4] border border-alive text-alive px-3 py-1.5 rounded text-xs font-sans cursor-pointer hover:bg-[#dcfce7] disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={submit} disabled={submitting}
      >
        {submitting ? 'spawning...' : 'spawn'}
      </button>
      {error && <div class="text-error text-[11px]">{error}</div>}
    </div>
  );
}

function GlobalBudgetDisplay() {
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState(20);
  const [action, setAction] = useState('sleep');

  const b = useValue(globalBudget);
  if (!b) return null;

  if (editing) {
    const save = async () => {
      await api.updateGlobalBudget(cap, action);
      await loadGlobalBudget();
      setEditing(false);
    };
    return (
      <div class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-accent rounded text-[11px] text-text-secondary flex-wrap">
        <span class="text-text-muted text-[10px]">$/day</span>
        <input
          type="number" min="0" step="1" value={cap}
          class="w-[50px] bg-white border border-[#d0d0d0] text-warn-light px-1.5 py-0.5 rounded text-[11px] text-right font-sans focus:outline-none focus:border-accent"
          onInput={(e) => setCap(parseFloat((e.target as HTMLInputElement).value))}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          ref={(el) => el?.focus()}
        />
        <select
          class="bg-white border border-[#d0d0d0] text-text-primary px-1 py-0.5 rounded text-[11px] font-sans focus:outline-none focus:border-accent"
          value={action} onChange={(e) => setAction((e.target as HTMLSelectElement).value)}
        >
          <option value="sleep">sleep</option>
          <option value="warn">warn</option>
          <option value="off">off</option>
        </select>
        <button class="bg-[#f0fdf4] border border-alive text-alive px-2 py-0.5 rounded text-[11px] cursor-pointer hover:bg-[#dcfce7]" onClick={save}>save</button>
        <button class="border border-[#d0d0d0] text-text-muted px-1.5 py-0.5 rounded text-[11px] cursor-pointer hover:text-text-secondary hover:border-text-muted" onClick={() => setEditing(false)}>x</button>
      </div>
    );
  }

  const label = b.action === 'off' ? 'no cap' : `$${b.daily_usd}/day · ${b.action}`;
  return (
    <div class="text-text-muted">
      <span class="text-text-muted">global cap: </span>
      <span
        class="text-warn-light cursor-pointer hover:underline"
        onClick={() => { setCap(b.daily_usd); setAction(b.action); setEditing(true); }}
      >
        {label} ✎
      </span>
    </div>
  );
}

export function Sidebar() {
  const [showSpawn, setShowSpawn] = useState(false);
  const crMap = useValue(creatures);
  const sel = useValue(selected);
  const budgets = useValue(creatureBudgets);
  const names = Object.keys(crMap).sort();

  const onOverview = sel === null;

  const goOverview = () => {
    selectCreature(null);
    sidebarOpen.value = false;
  };

  return (
    <div class="sticky top-0 h-screen w-[260px] border-r border-border-default bg-surface flex flex-col shrink-0 overflow-y-auto animate-[slide-in-left_0.15s_ease-out]">
      {/* Header */}
      <div class="px-4 py-4 text-text-primary text-[17px] font-medium font-serif tracking-[-0.02em] border-b border-border-default flex items-center justify-between">
        <span class="cursor-pointer hover:text-narrator transition-colors" onClick={goOverview}>openseed</span>
        <button
          class="w-6 h-6 rounded flex items-center justify-center cursor-pointer shrink-0 text-text-faint hover:text-text-secondary transition-colors"
          onClick={() => { if (onOverview) sidebarOpen.value = false; else goOverview(); }}
          title={onOverview ? 'Collapse sidebar' : 'Back to overview'}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="w-[13px] h-[13px]">
            <rect x="1" y="2" width="14" height="12" rx="2" />
            <line x1="5.5" y1="2" x2="5.5" y2="14" />
          </svg>
        </button>
      </div>

      {/* Creature list */}
      <div class="p-2 flex-1">
        <div
          class={`px-3 py-2 rounded cursor-pointer flex items-center gap-2 mb-0.5 transition-colors ${onOverview ? 'bg-[#eff6ff] border-l-2 border-accent' : 'hover:bg-[#f5f5f5]'}`}
          onClick={goOverview}
        >
          <span class="text-text-muted text-[12px]">overview</span>
        </div>

        {names.map(n => {
          const c = crMap[n];
          const b = budgets[n];
          const isSel = sel === n;

          let costLabel = null;
          if (b && b.action !== 'off' && b.daily_cap_usd > 0) {
            const pct = Math.min(100, Math.round((b.daily_spent_usd / b.daily_cap_usd) * 100));
            const cls = pct >= 100 ? 'text-error' : pct >= 80 ? 'text-warn-light' : 'text-text-muted';
            costLabel = <span class={`text-[10px] ml-1 shrink-0 ${cls}`}>{pct}%</span>;
          }

          const budgetCapped = c.sleepReason === 'budget';

          return (
            <div
              key={n}
              class={`px-3 py-2 rounded cursor-pointer flex items-center gap-2 mb-0.5 transition-colors ${isSel ? 'bg-[#eff6ff] border-l-2 border-accent' : 'hover:bg-[#f5f5f5]'}`}
              onClick={() => selectCreature(n)}
            >
              <StatusDot status={c.status} />
              <span class="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{n}</span>
              {budgetCapped && <span class="text-[10px] text-error ml-1">capped</span>}
              {costLabel}
              {c.status === 'stopped' || budgetCapped ? (
                <button class="bg-white border border-[#d0d0d0] text-text-secondary px-1.5 py-0.5 rounded text-[11px] cursor-pointer hover:bg-[#f5f5f5] hover:text-text-primary transition-colors" onClick={(e) => { e.stopPropagation(); api.creatureAction(n, 'start').then(refresh); }}>start</button>
              ) : (
                <button class="bg-white border border-[#d0d0d0] text-text-secondary px-1.5 py-0.5 rounded text-[11px] cursor-pointer hover:bg-[#f5f5f5] hover:text-text-primary transition-colors" onClick={(e) => { e.stopPropagation(); api.creatureAction(n, 'stop').then(refresh); }}>stop</button>
              )}
            </div>
          );
        })}

        {/* Spawn action */}
        <div class="mx-3 mt-1 mb-1 border-t border-border-light" />
        <div
          class="px-3 py-2 rounded cursor-pointer flex items-center gap-2 text-text-faint text-[12px] hover:text-narrator transition-colors"
          onClick={() => setShowSpawn(!showSpawn)}
        >
          <span>+ spawn creature</span>
        </div>
        {showSpawn && <SpawnForm onClose={() => setShowSpawn(false)} />}
      </div>

      {/* Footer */}
      <div class="border-t border-border-default p-3 text-[11px] shrink-0">
        <GlobalBudgetDisplay />
      </div>
    </div>
  );
}
