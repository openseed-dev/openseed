/**
 * Read-only Janee config viewer for the Settings modal.
 * Fetches ~/.janee/config.yaml via /api/janee/config and displays
 * services, capabilities, and agent access in a compact layout.
 */
import { useState, useEffect } from 'react';
import * as api from '@/api';
import type { JaneeConfigView, MaskedService, MaskedCapability, AgentAccess } from '@/types';

const tabs = ['Services', 'Capabilities', 'Agents'] as const;
type Tab = typeof tabs[number];

function ServicesTab({ services }: { services: MaskedService[] }) {
  if (!services.length) return <p className="text-[12px] text-text-muted py-4">No services configured. Add one with <code className="bg-surface px-1 rounded">janee add</code>.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {services.map(svc => (
        <div key={svc.name} className="flex items-center justify-between bg-surface border border-border-light rounded px-3 py-2">
          <div>
            <span className="text-[13px] font-medium text-text-primary">{svc.name}</span>
            <span className="text-[11px] text-text-muted ml-2 font-mono">{svc.baseUrl}</span>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-hover text-text-secondary border border-border-light">
            {svc.authType}
          </span>
        </div>
      ))}
    </div>
  );
}

function CapabilitiesTab({ capabilities }: { capabilities: MaskedCapability[] }) {
  if (!capabilities.length) return <p className="text-[12px] text-text-muted py-4">No capabilities configured.</p>;

  const grouped = new Map<string, MaskedCapability[]>();
  for (const cap of capabilities) {
    const key = cap.service || 'unbound';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(cap);
  }

  return (
    <div className="flex flex-col gap-3">
      {Array.from(grouped.entries()).map(([service, caps]) => (
        <div key={service}>
          <div className="text-[11px] uppercase tracking-[0.04em] text-text-faint mb-1">{service}</div>
          {caps.map(cap => (
            <div key={cap.name} className="flex items-center gap-2 bg-surface border border-border-light rounded px-3 py-2 mb-1">
              <span className="text-[12px] font-medium text-text-primary">{cap.name}</span>
              <span className="text-[10px] text-text-muted">{cap.mode}</span>
              {cap.autoApprove && <span className="text-[9px] px-1 py-0.5 rounded bg-green-900/20 text-green-400">auto</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function AgentsTab({ agents }: { agents: AgentAccess[] }) {
  if (!agents.length) return <p className="text-[12px] text-text-muted py-4">No agent access rules defined.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {agents.map(a => (
        <div key={a.agentId} className="flex items-center justify-between bg-surface border border-border-light rounded px-3 py-2">
          <span className="text-[12px] font-medium text-text-primary">{a.agentId}</span>
          <div className="flex gap-1">
            {a.capabilities.map(s => (
              <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-hover text-text-secondary border border-border-light">{s}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function JaneeSection() {
  const [tab, setTab] = useState<Tab>('Services');
  const [config, setConfig] = useState<JaneeConfigView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.fetchJaneeConfig()
      .then(setConfig)
      .catch(() => setError('Could not load Janee config. Is Janee running?'));
  }, []);

  if (error || (config && !config.available)) {
    return (
      <div>
        <h3 className="text-[15px] font-semibold text-text-primary mb-1">Janee</h3>
        <p className="text-[12px] text-text-muted">{error || 'Could not load Janee config. Is Janee running?'}</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div>
        <h3 className="text-[15px] font-semibold text-text-primary mb-1">Janee</h3>
        <p className="text-[12px] text-text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-[15px] font-semibold text-text-primary mb-1">Janee</h3>
      <p className="text-[12px] text-text-muted mb-4 leading-relaxed">
        Read-only view of <code className="bg-surface px-1 rounded text-[11px]">~/.janee/config.yaml</code>. Edit the file directly to make changes.
      </p>

      <div className="flex gap-1 mb-4 border-b border-border-light">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-[12px] border-b-2 transition-colors -mb-px ${
              tab === t
                ? 'border-accent text-text-primary font-medium'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Services' && <ServicesTab services={config.services} />}
      {tab === 'Capabilities' && <CapabilitiesTab capabilities={config.capabilities} />}
      {tab === 'Agents' && <AgentsTab agents={config.agents} />}
    </div>
  );
}
