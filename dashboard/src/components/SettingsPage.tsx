import { useState, useEffect } from 'react';
import { useStore } from '@/state';
import * as api from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

/* ────────────────────────── Limits Tab ────────────────────────── */

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

/* ────────────────────────── Services Tab ────────────────────────── */

interface ServiceInfo {
  name: string;
  status: 'running' | 'configured' | 'error' | 'unconfigured';
  detail?: string;
  port?: number;
  config?: string;
  capabilities?: string[];
}

function ServicesSection() {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/services');
      if (res.ok) {
        setServices(await res.json());
      }
    } catch {
      // API may not exist yet — show placeholder
    } finally {
      setLoading(false);
    }
  };

  const statusIcon = (s: ServiceInfo['status']) => {
    switch (s) {
      case 'running': return '🟢';
      case 'configured': return '🟡';
      case 'error': return '🔴';
      default: return '⚪';
    }
  };

  const statusLabel = (s: ServiceInfo['status']) => {
    switch (s) {
      case 'running': return 'running';
      case 'configured': return 'stopped';
      case 'error': return 'error';
      default: return 'not configured';
    }
  };

  return (
    <div>
      <h3 className="text-[15px] font-semibold text-text-primary mb-1">Services</h3>
      <p className="text-[12px] text-text-muted mb-6 leading-relaxed">External services available to creatures.</p>

      {loading ? (
        <p className="text-[12px] text-text-muted">Loading services...</p>
      ) : services.length === 0 ? (
        <div className="rounded-lg border border-border/50 p-6 text-center">
          <p className="text-[12px] text-text-muted mb-2">No services detected.</p>
          <p className="text-[11px] text-text-muted">Services will appear here once backend support is available.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {services.map(svc => (
            <div key={svc.name} className="rounded-lg border border-border/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[14px]">{statusIcon(svc.status)}</span>
                  <span className="text-[14px] font-semibold text-text-primary">{svc.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {statusLabel(svc.status)}
                  </Badge>
                </div>
              </div>
              {svc.detail && (
                <p className="text-[11px] text-text-muted mb-1">{svc.detail}</p>
              )}
              {svc.port && (
                <p className="text-[11px] text-text-secondary">Port: {svc.port}</p>
              )}
              {svc.capabilities && svc.capabilities.length > 0 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {svc.capabilities.map(cap => (
                    <Badge key={cap} variant="secondary" className="text-[10px]">{cap}</Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── Credentials Tab ────────────────────────── */

interface CredentialInfo {
  key: string;
  source: string;
  assignedTo: string[];
  masked: string;
}

function CredentialsSection() {
  const [credentials, setCredentials] = useState<CredentialInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const creatures = useStore(s => s.creatures);

  useEffect(() => {
    loadCredentials();
  }, []);

  const loadCredentials = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/credentials');
      if (res.ok) {
        setCredentials(await res.json());
      }
    } catch {
      // API may not exist yet
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h3 className="text-[15px] font-semibold text-text-primary mb-1">Credentials</h3>
      <p className="text-[12px] text-text-muted mb-6 leading-relaxed">
        Secrets available to creatures. Managed via Janee's secret store.
      </p>

      {loading ? (
        <p className="text-[12px] text-text-muted">Loading credentials...</p>
      ) : credentials.length === 0 ? (
        <div className="rounded-lg border border-border/50 p-6 text-center">
          <p className="text-[12px] text-text-muted mb-2">No credentials configured.</p>
          <p className="text-[11px] text-text-muted">
            Credentials will be manageable here once the backend API is connected.
          </p>
        </div>
      ) : (
        <>
          {/* Credentials table */}
          <div className="rounded-lg border border-border/50 overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border/50 bg-bg-sidebar/30">
                  <th className="text-left px-3 py-2 text-text-secondary font-medium text-[11px] uppercase tracking-[0.03em]">Key</th>
                  <th className="text-left px-3 py-2 text-text-secondary font-medium text-[11px] uppercase tracking-[0.03em]">Value</th>
                  <th className="text-left px-3 py-2 text-text-secondary font-medium text-[11px] uppercase tracking-[0.03em]">Source</th>
                  <th className="text-left px-3 py-2 text-text-secondary font-medium text-[11px] uppercase tracking-[0.03em]">Assigned to</th>
                </tr>
              </thead>
              <tbody>
                {credentials.map(cred => (
                  <tr key={cred.key} className="border-b border-border/30 last:border-b-0">
                    <td className="px-3 py-2 font-mono text-text-primary">{cred.key}</td>
                    <td className="px-3 py-2 text-text-muted font-mono">{cred.masked}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-[10px]">{cred.source}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {cred.assignedTo.length === 0
                        ? <span className="text-text-muted">—</span>
                        : cred.assignedTo.map(name => (
                            <Badge key={name} variant="secondary" className="text-[10px] mr-1">{name}</Badge>
                          ))
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Access matrix */}
          {creatures.length > 0 && (
            <div className="mt-6">
              <h4 className="text-[13px] font-semibold text-text-primary mb-3">Per-creature access</h4>
              <div className="rounded-lg border border-border/50 p-3">
                <div className="flex flex-col gap-2">
                  {creatures.map(c => (
                    <div key={c.name} className="flex items-center gap-3">
                      <span className="text-[12px] text-text-primary w-[140px] truncate font-medium">{c.name}</span>
                      <div className="flex gap-1 flex-wrap">
                        {credentials.map(cred => {
                          const hasAccess = cred.assignedTo.length === 0 || cred.assignedTo.includes(c.name);
                          return (
                            <Badge
                              key={cred.key}
                              variant={hasAccess ? 'default' : 'outline'}
                              className={`text-[9px] ${hasAccess ? 'opacity-100' : 'opacity-30'}`}
                            >
                              {cred.key.replace(/^(.*?)_/, '').slice(0, 8)}..
                              {hasAccess ? ' ✓' : ''}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ────────────────────────── Narrator Tab ────────────────────────── */

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
      <p className="text-[12px] text-text-muted mb-6 leading-relaxed">
        Periodic narration of creature activity.
      </p>

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <Label className="text-[12px] text-text-primary">Enable narration</Label>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[11px] text-text-secondary tracking-[0.03em] uppercase">Model</Label>
          <Input
            value={model}
            className="w-[280px]"
            onChange={(e) => setModel(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[11px] text-text-secondary tracking-[0.03em] uppercase">Interval (minutes)</Label>
          <Input
            type="number" min={1} step={1} value={interval}
            className="w-[120px]"
            onChange={(e) => setInterval_(parseInt(e.target.value))}
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

/* ────────────────────────── Main Settings Page ────────────────────────── */

export function SettingsPage() {
  const setSettingsOpen = useStore(s => s.setSettingsOpen);

  return (
    <div className="flex-1 min-w-0 flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSettingsOpen(false)}
            className="text-text-muted hover:text-text-primary transition-colors text-[18px]"
            title="Back to dashboard"
          >
            ←
          </button>
          <h1 className="text-[18px] font-semibold text-text-primary">Settings</h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="max-w-[680px]">
          <Tabs defaultValue="limits">
            <TabsList variant="line" className="mb-6">
              <TabsTrigger value="limits">Limits</TabsTrigger>
              <TabsTrigger value="services">Services</TabsTrigger>
              <TabsTrigger value="credentials">Credentials</TabsTrigger>
              <TabsTrigger value="narrator">Narrator</TabsTrigger>
            </TabsList>

            <TabsContent value="limits">
              <LimitsSection />
            </TabsContent>

            <TabsContent value="services">
              <ServicesSection />
            </TabsContent>

            <TabsContent value="credentials">
              <CredentialsSection />
            </TabsContent>

            <TabsContent value="narrator">
              <NarratorSection />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
