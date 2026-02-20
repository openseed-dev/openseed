import { useState } from 'preact/hooks';
import { fmtCost } from '../utils';
import * as api from '../api';
import { creatureBudgets, selected } from '../state';
import { useValue } from '../hooks';
import type { BudgetInfo as BInfo } from '../types';

export function BudgetInfo() {
  const name = useValue(selected);
  const budgets = useValue(creatureBudgets);
  const budget = name ? budgets[name] : null;
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState(20);
  const [action, setAction] = useState('sleep');

  if (!budget || !name) return null;

  const save = async () => {
    const updated = await api.updateCreatureBudget(name, cap, action);
    creatureBudgets.value = { ...creatureBudgets.value, [name]: updated };
    setEditing(false);
  };

  const cancel = () => setEditing(false);

  if (editing) {
    return (
      <div class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-accent rounded text-[11px] text-text-secondary">
        <span class="text-text-muted">daily $</span>
        <input
          type="number" min="0" step="1" value={cap}
          class="w-[60px] bg-white border border-[#d0d0d0] text-warn-light px-1.5 py-0.5 rounded text-[11px] text-right font-sans focus:outline-none focus:border-accent"
          onInput={(e) => setCap(parseFloat((e.target as HTMLInputElement).value))}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
          ref={(el) => el?.focus()}
        />
        <select
          class="bg-white border border-[#d0d0d0] text-text-primary px-1 py-0.5 rounded text-[11px] font-sans focus:outline-none focus:border-accent"
          value={action}
          onChange={(e) => setAction((e.target as HTMLSelectElement).value)}
        >
          <option value="sleep">sleep when exceeded</option>
          <option value="warn">warn only</option>
          <option value="off">no cap</option>
        </select>
        <button class="bg-[#f0fdf4] border border-alive text-alive px-2 py-px rounded text-[11px] cursor-pointer hover:bg-[#dcfce7]" onClick={save}>save</button>
        <button class="border border-[#d0d0d0] text-text-muted px-1.5 py-px rounded text-[11px] cursor-pointer hover:text-text-secondary hover:border-text-muted" onClick={cancel}>cancel</button>
      </div>
    );
  }

  const openEditor = () => {
    setCap(budget.daily_cap_usd);
    setAction(budget.action);
    setEditing(true);
  };

  if (budget.action === 'off') {
    return (
      <div class="inline-flex items-center gap-2 px-2.5 py-1 bg-white border border-border-light rounded text-[11px] text-text-secondary cursor-pointer hover:border-[#d0d0d0]" onClick={openEditor}>
        <span class="text-text-muted">cap off</span>
        <span class="text-text-muted">click to edit</span>
      </div>
    );
  }

  const pct = budget.daily_cap_usd > 0 ? Math.min(100, (budget.daily_spent_usd / budget.daily_cap_usd) * 100) : 0;
  const cls = budget.status === 'exceeded' ? 'text-error' : pct >= 80 ? 'text-warn-light' : 'text-alive';
  const barCls = budget.status === 'exceeded' ? 'bg-error' : pct >= 80 ? 'bg-warn' : 'bg-alive';

  return (
    <div class="inline-flex items-center gap-2 px-2.5 py-1 bg-white border border-border-light rounded text-[11px] text-text-secondary cursor-pointer hover:border-[#d0d0d0]" onClick={openEditor}>
      <span class="text-text-muted">today</span>
      <span class={cls}>{fmtCost(budget.daily_spent_usd)}</span>
      <span class="text-text-muted">/ {fmtCost(budget.daily_cap_usd)}</span>
      <div class="w-[60px] h-[3px] bg-border-light rounded overflow-hidden">
        <div class={`h-full rounded transition-[width] duration-300 ${barCls}`} style={{ width: `${pct}%` }} />
      </div>
      {budget.status === 'exceeded' && <span class="text-error">exceeded</span>}
    </div>
  );
}
