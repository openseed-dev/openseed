import { useState } from 'react';
import { useStore } from '@/state';
import * as api from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Settings, PanelLeft } from 'lucide-react';

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    stopped: 'bg-text-muted',
    spawning: 'bg-warn animate-pulse',
    starting: 'bg-warn',
    running: 'bg-alive',
    sleeping: 'bg-dormant',
    error: 'bg-error animate-[pulse-error_1s_ease-in-out_infinite]',
  };
  return <span className={`w-2 h-2 rounded-full shrink-0 ${colors[status] || 'bg-text-muted'}`} />;
}

function SpawnForm({ onClose }: { onClose: () => void }) {
  const genomes = useStore(s => s.genomes);
  const refresh = useStore(s => s.refresh);
  const selectCreature = useStore(s => s.selectCreature);
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
        genome || genomes[0]?.name || 'minimal',
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
    <div className="p-3 border-b border-border-light bg-[#f5f5f5] flex flex-col gap-2">
      <Input
        placeholder="name (lowercase)" maxLength={32}
        className="text-xs h-8"
        value={name} onChange={(e) => setName(e.target.value)}
      />
      <select
        className="bg-white border border-input text-text-primary px-2 py-1.5 rounded text-xs font-sans focus:outline-none focus:border-ring"
        value={genome} onChange={(e) => setGenome(e.target.value)}
      >
        {genomes.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
      </select>
      <select
        className="bg-white border border-input text-text-primary px-2 py-1.5 rounded text-xs font-sans focus:outline-none focus:border-ring"
        value={model} onChange={(e) => setModel(e.target.value)}
      >
        <option value="">model (default: opus)</option>
        <option value="claude-opus-4-6">claude-opus-4-6 ($5/$25)</option>
        <option value="claude-sonnet-4-6">claude-sonnet-4-6 ($3/$15)</option>
        <option value="claude-haiku-4-5">claude-haiku-4-5 ($1/$5)</option>
        <option value="gpt-5.2">gpt-5.2 ($1.75/$14)</option>
        <option value="gpt-5-mini">gpt-5-mini ($0.25/$2)</option>
        <option value="o4-mini">o4-mini ($1.10/$4.40)</option>
      </select>
      <textarea
        className="bg-white border border-input text-text-primary px-2 py-1.5 rounded text-xs font-sans resize-y min-h-12 focus:outline-none focus:border-ring"
        placeholder="purpose (optional)" rows={3}
        value={purpose} onChange={(e) => setPurpose(e.target.value)}
      />
      <Button
        variant="outline" size="sm"
        className="border-alive text-alive hover:bg-[#dcfce7]"
        onClick={submit} disabled={submitting}
      >
        {submitting ? 'spawning...' : 'spawn'}
      </Button>
      {error && <div className="text-error text-[11px]">{error}</div>}
    </div>
  );
}

export function Sidebar() {
  const [showSpawn, setShowSpawn] = useState(false);
  const crMap = useStore(s => s.creatures);
  const sel = useStore(s => s.selected);
  const budgets = useStore(s => s.creatureBudgets);
  const selectCreature = useStore(s => s.selectCreature);
  const refresh = useStore(s => s.refresh);
  const setSidebarOpen = useStore(s => s.setSidebarOpen);
  const setSettingsOpen = useStore(s => s.setSettingsOpen);
  const names = Object.keys(crMap).sort();

  const onOverview = sel === null;

  const goOverview = () => {
    selectCreature(null);
    setSidebarOpen(false);
  };

  return (
    <div className="sticky top-0 h-screen w-[260px] border-r border-border-default bg-surface flex flex-col shrink-0 overflow-hidden animate-[slide-in-left_0.15s_ease-out]">
      {/* Header */}
      <div className="px-4 py-4 text-text-primary text-[17px] font-medium font-serif tracking-[-0.02em] border-b border-border-default flex items-center justify-between">
        <span className="cursor-pointer hover:text-narrator transition-colors" onClick={goOverview}>openseed</span>
        <Button
          variant="ghost" size="icon-xs"
          className="text-text-faint hover:text-text-secondary"
          onClick={() => { if (onOverview) setSidebarOpen(false); else goOverview(); }}
          title={onOverview ? 'Collapse sidebar' : 'Back to overview'}
        >
          <PanelLeft className="size-[13px]" />
        </Button>
      </div>

      {/* Creature list */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          <div
            className={`px-3 py-2 rounded cursor-pointer flex items-center gap-2 mb-0.5 transition-colors ${onOverview ? 'bg-[#eff6ff] border-l-2 border-accent-blue' : 'hover:bg-[#f5f5f5]'}`}
            onClick={goOverview}
          >
            <span className="text-text-muted text-[12px]">overview</span>
          </div>

          {names.map(n => {
            const c = crMap[n];
            const b = budgets[n];
            const isSel = sel === n;

            let costLabel = null;
            if (b && b.action !== 'off' && b.daily_cap_usd > 0) {
              const pct = Math.min(100, Math.round((b.daily_spent_usd / b.daily_cap_usd) * 100));
              const cls = pct >= 100 ? 'text-error' : pct >= 80 ? 'text-warn-light' : 'text-text-muted';
              costLabel = <span className={`text-[10px] ml-1 shrink-0 ${cls}`}>{pct}%</span>;
            }

            const budgetCapped = c.sleepReason === 'budget';

            return (
              <div
                key={n}
                className={`px-3 py-2 rounded cursor-pointer flex items-center gap-2 mb-0.5 transition-colors ${isSel ? 'bg-[#eff6ff] border-l-2 border-accent-blue' : 'hover:bg-[#f5f5f5]'}`}
                onClick={() => selectCreature(n)}
              >
                <StatusDot status={c.status} />
                <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{n}</span>
                {budgetCapped && <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4">capped</Badge>}
                {costLabel}
                {c.status === 'spawning' ? (
                  <span className="text-[10px] text-warn-light animate-pulse">spawning...</span>
                ) : c.status === 'stopped' || budgetCapped ? (
                  <button className="bg-white border border-[#d0d0d0] text-text-secondary px-1.5 py-0.5 rounded text-[11px] cursor-pointer hover:bg-[#f5f5f5] hover:text-text-primary transition-colors" onClick={(e) => { e.stopPropagation(); api.creatureAction(n, 'start').then(refresh); }}>start</button>
                ) : (
                  <button className="bg-white border border-[#d0d0d0] text-text-secondary px-1.5 py-0.5 rounded text-[11px] cursor-pointer hover:bg-[#f5f5f5] hover:text-text-primary transition-colors" onClick={(e) => { e.stopPropagation(); api.creatureAction(n, 'stop').then(refresh); }}>stop</button>
                )}
              </div>
            );
          })}

          <Separator className="mx-3 my-1" />
          <div
            className="px-3 py-2 rounded cursor-pointer flex items-center gap-2 text-text-faint text-[12px] hover:text-narrator transition-colors"
            onClick={() => setShowSpawn(!showSpawn)}
          >
            <span>+ spawn creature</span>
          </div>
          {showSpawn && <SpawnForm onClose={() => setShowSpawn(false)} />}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-border-default p-3 text-[11px] shrink-0">
        <div
          className="flex items-center gap-1.5 text-text-muted cursor-pointer hover:text-text-primary transition-colors"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="size-3.5" />
          <span>Settings</span>
        </div>
      </div>
    </div>
  );
}
