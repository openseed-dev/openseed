import { useState, useEffect } from 'react';
import { useStore } from '@/state';
import * as api from '@/api';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

function LimitsSection() {
  const budget = useStore(s => s.globalBudget);
  const loadGlobalBudget = useStore(s => s.loadGlobalBudget);
  const [cap, setCap] = useState(20);
  const [action, setAction] = useState('sleep');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (budget) {
      setCap(budget.daily_usd);
      setAction(budget.action);
    }
  }, [budget]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.updateGlobalBudget(cap, action);
      await loadGlobalBudget();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h3 className="text-[15px] font-semibold text-text-primary mb-1">Limits</h3>
      <p className="text-[12px] text-text-muted mb-6 leading-relaxed">Default daily spend cap applied to each creature.</p>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11px] text-text-secondary tracking-[0.03em] uppercase">Daily cap ($)</Label>
          <Input
            type="number" min={0} step={1} value={cap}
            className="w-[120px]"
            onChange={(e) => setCap(parseFloat(e.target.value))}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[11px] text-text-secondary tracking-[0.03em] uppercase">When exceeded</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sleep">Sleep the creature</SelectItem>
              <SelectItem value="warn">Warn only</SelectItem>
              <SelectItem value="off">No cap</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3 mt-2">
          <Button onClick={save} disabled={saving} size="sm">
            {saving ? 'Saving...' : 'Save'}
          </Button>
          {saved && <span className="text-alive text-[12px]">Saved</span>}
        </div>
      </div>
    </div>
  );
}

function NarratorSection() {
  const config = useStore(s => s.narratorConfig);
  const loadNarratorConfig = useStore(s => s.loadNarratorConfig);
  const [enabled, setEnabled] = useState(true);
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [interval, setInterval_] = useState(5);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) {
      setEnabled(config.enabled);
      setModel(config.model);
      setInterval_(config.interval_minutes);
    }
  }, [config]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.updateNarratorConfig({ enabled, model, interval_minutes: interval });
      await loadNarratorConfig();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h3 className="text-[15px] font-semibold text-text-primary mb-1">Narrator</h3>
      <p className="text-[12px] text-text-muted mb-6 leading-relaxed">The narrator periodically summarizes what your creatures are doing.</p>

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <Label className="text-[13px] text-text-primary">Enabled</Label>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[11px] text-text-secondary tracking-[0.03em] uppercase">Model</Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="claude-opus-4-6">claude-opus-4-6</SelectItem>
              <SelectItem value="claude-sonnet-4-6">claude-sonnet-4-6</SelectItem>
              <SelectItem value="claude-haiku-4-5">claude-haiku-4-5</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[11px] text-text-secondary tracking-[0.03em] uppercase">Interval (minutes)</Label>
          <Input
            type="number" min={1} step={1} value={interval}
            className="w-[120px]"
            onChange={(e) => setInterval_(parseInt(e.target.value) || 1)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          />
        </div>

        <div className="flex items-center gap-3 mt-2">
          <Button onClick={save} disabled={saving} size="sm">
            {saving ? 'Saving...' : 'Save'}
          </Button>
          {saved && <span className="text-alive text-[12px]">Saved</span>}
        </div>
      </div>
    </div>
  );
}

export function SettingsModal() {
  const open = useStore(s => s.settingsOpen);
  const setSettingsOpen = useStore(s => s.setSettingsOpen);
  const loadGlobalBudget = useStore(s => s.loadGlobalBudget);
  const loadNarratorConfig = useStore(s => s.loadNarratorConfig);
  const [section, setSection] = useState('limits');

  useEffect(() => {
    if (open) {
      loadGlobalBudget();
      loadNarratorConfig();
    }
  }, [open, loadGlobalBudget, loadNarratorConfig]);

  const sections = [
    { id: 'limits', label: 'Limits' },
    { id: 'narrator', label: 'Narrator' },
  ];

  return (
    <Dialog open={open} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-w-[680px] h-[440px] p-0 gap-0 flex overflow-hidden">
        <div className="w-[160px] border-r border-border-default bg-bg py-5 px-3 flex flex-col shrink-0">
          <div className="text-[11px] text-text-faint tracking-[0.04em] uppercase px-2 mb-3">Settings</div>
          {sections.map(s => (
            <div
              key={s.id}
              className={`px-3 py-1.5 rounded cursor-pointer text-[13px] transition-colors ${section === s.id ? 'bg-surface text-text-primary font-medium' : 'text-text-muted hover:text-text-primary'}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </div>
          ))}
        </div>

        <div className="flex-1 p-7 overflow-y-auto">
          {section === 'limits' && <LimitsSection />}
          {section === 'narrator' && <NarratorSection />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
