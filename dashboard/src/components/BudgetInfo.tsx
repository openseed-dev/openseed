import { useState } from 'react';
import { fmtCost } from '@/utils';
import * as api from '@/api';
import { useStore } from '@/state';
import type { BudgetInfo as BInfo } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function BudgetInfo() {
  const name = useStore(s => s.selected);
  const budgets = useStore(s => s.creatureBudgets);
  const budget = name ? budgets[name] : null;
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState(20);
  const [action, setAction] = useState('sleep');

  if (!budget || !name) return null;

  const save = async () => {
    const updated = await api.updateCreatureBudget(name, cap, action);
    useStore.setState(s => ({ creatureBudgets: { ...s.creatureBudgets, [name]: updated } }));
    setEditing(false);
  };

  const cancel = () => setEditing(false);

  if (editing) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-accent-blue rounded text-[11px] text-text-secondary">
        <span className="text-text-muted">daily $</span>
        <Input
          type="number" min={0} step={1} value={cap}
          className="w-[60px] h-6 text-[11px] text-right px-1.5"
          onChange={(e) => setCap(parseFloat(e.target.value))}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
          autoFocus
        />
        <select
          className="bg-white border border-input text-text-primary px-1 py-0.5 rounded text-[11px] font-sans focus:outline-none focus:border-ring"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        >
          <option value="sleep">sleep when exceeded</option>
          <option value="warn">warn only</option>
          <option value="off">no cap</option>
        </select>
        <Button variant="outline" size="xs" className="border-alive text-alive hover:bg-[#dcfce7]" onClick={save}>save</Button>
        <Button variant="outline" size="xs" onClick={cancel}>cancel</Button>
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
      <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-white border border-border-light rounded text-[11px] text-text-secondary cursor-pointer hover:border-[#d0d0d0]" onClick={openEditor}>
        <span className="text-text-muted">cap off</span>
        <span className="text-text-muted">click to edit</span>
      </div>
    );
  }

  const pct = budget.daily_cap_usd > 0 ? Math.min(100, (budget.daily_spent_usd / budget.daily_cap_usd) * 100) : 0;
  const cls = budget.status === 'exceeded' ? 'text-error' : pct >= 80 ? 'text-warn-light' : 'text-alive';
  const barCls = budget.status === 'exceeded' ? 'bg-error' : pct >= 80 ? 'bg-warn' : 'bg-alive';

  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-white border border-border-light rounded text-[11px] text-text-secondary cursor-pointer hover:border-[#d0d0d0]" onClick={openEditor}>
      <span className="text-text-muted">today</span>
      <span className={cls}>{fmtCost(budget.daily_spent_usd)}</span>
      <span className="text-text-muted">/ {fmtCost(budget.daily_cap_usd)}</span>
      <div className="w-[60px] h-[3px] bg-border-light rounded overflow-hidden">
        <div className={`h-full rounded transition-[width] duration-300 ${barCls}`} style={{ width: `${pct}%` }} />
      </div>
      {budget.status === 'exceeded' && <span className="text-error">exceeded</span>}
    </div>
  );
}
