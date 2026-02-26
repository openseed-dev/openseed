import { useState, useEffect } from 'react';
import * as api from '@/api';
import type { JaneeConfigView, MaskedService, MaskedCapability, AgentAccess } from '@/types';

const tabs = ['Services', 'Agents'] as const;
type Tab = typeof tabs[number];

function CapRow({ cap, agents }: { cap: MaskedCapability; agents: string[] }) {
  return (
    <div className="group px-4 py-2.5 border-t border-border-light/60 hover:bg-[#faf9f6] transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-[12.5px] text-text-primary tracking-[-0.01em]">{cap.name}</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm bg-[#f0ede7] text-text-secondary">{cap.mode}</span>
        </div>
      </div>
      {agents.length > 0 && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <span className="text-[9px] uppercase tracking-[0.06em] text-text-faint mr-0.5">access</span>
          {agents.map(a => (
            <span key={a} className="text-[10px] font-mono text-text-muted">{a}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceCard({ svc, caps, agentsByCap }: {
  svc: MaskedService;
  caps: MaskedCapability[];
  agentsByCap: Map<string, string[]>;
}) {
  return (
    <div className="rounded-lg border border-border-light overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-[#fdfcfa] border-b border-border-light/60">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-text-primary">{svc.name}</span>
          <span className="text-[10.5px] font-mono text-text-muted truncate max-w-[200px]">{svc.baseUrl}</span>
        </div>
        <span className="text-[9.5px] uppercase tracking-[0.05em] text-text-faint font-medium">
          {svc.authType}
        </span>
      </div>
      {caps.length > 0 ? (
        caps.map(cap => (
          <CapRow
            key={cap.name}
            cap={cap}
            agents={agentsByCap.get(cap.name) || cap.allowedAgents || []}
          />
        ))
      ) : (
        <div className="px-4 py-3 text-[11px] text-text-faint italic">No capabilities</div>
      )}
    </div>
  );
}

function ServicesTab({ services, capabilities, agents }: {
  services: MaskedService[];
  capabilities: MaskedCapability[];
  agents: AgentAccess[];
}) {
  if (!services.length && !capabilities.length) {
    return (
      <div className="py-8 text-center">
        <p className="text-[12px] text-text-muted">No services configured.</p>
        <p className="text-[11px] text-text-faint mt-1">
          Run <code className="font-mono bg-[#f0ede7] px-1.5 py-0.5 rounded-sm text-[10.5px]">janee add</code> to get started.
        </p>
      </div>
    );
  }

  const capsByService = new Map<string, MaskedCapability[]>();
  for (const cap of capabilities) {
    const key = cap.service || '';
    if (!capsByService.has(key)) capsByService.set(key, []);
    capsByService.get(key)!.push(cap);
  }

  const agentsByCap = new Map<string, string[]>();
  for (const a of agents) {
    for (const capName of a.capabilities) {
      if (!agentsByCap.has(capName)) agentsByCap.set(capName, []);
      agentsByCap.get(capName)!.push(a.agentId);
    }
  }

  const unbound = capsByService.get('') || [];

  return (
    <div className="flex flex-col gap-2.5">
      {services.map(svc => (
        <ServiceCard
          key={svc.name}
          svc={svc}
          caps={capsByService.get(svc.name) || []}
          agentsByCap={agentsByCap}
        />
      ))}
      {unbound.length > 0 && (
        <div className="rounded-lg border border-dashed border-border-light overflow-hidden">
          <div className="px-4 py-2.5 bg-[#fdfcfa] border-b border-border-light/60">
            <span className="text-[10px] uppercase tracking-[0.06em] text-text-faint font-medium">Unbound capabilities</span>
          </div>
          {unbound.map(cap => (
            <CapRow
              key={cap.name}
              cap={cap}
              agents={agentsByCap.get(cap.name) || cap.allowedAgents || []}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentsTab({ agents }: { agents: AgentAccess[] }) {
  if (!agents.length) {
    return (
      <div className="py-8 text-center">
        <p className="text-[12px] text-text-muted">No agent access rules defined.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {agents.map(a => (
        <div key={a.agentId} className="rounded-lg border border-border-light px-4 py-3">
          <div className="text-[13px] font-medium text-text-primary mb-2">{a.agentId}</div>
          <div className="flex flex-wrap gap-1.5">
            {a.capabilities.map(s => (
              <span key={s} className="text-[10.5px] font-mono px-2 py-0.5 rounded-sm bg-[#f0ede7] text-text-secondary">{s}</span>
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

  if (error) {
    return (
      <div>
        <h3 className="text-[15px] font-semibold text-text-primary mb-1">Janee</h3>
        <p className="text-[12px] text-text-muted">{error}</p>
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
      <p className="text-[12px] text-text-muted mb-5 leading-relaxed">
        Read-only view of <code className="font-mono bg-[#f0ede7] px-1.5 py-0.5 rounded-sm text-[10.5px]">~/.janee/config.yaml</code>
      </p>

      <div className="flex gap-0 mb-4">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3.5 py-1.5 text-[11.5px] tracking-[-0.01em] rounded-full transition-all ${
              tab === t
                ? 'bg-text-primary text-white font-medium'
                : 'text-text-muted hover:text-text-primary hover:bg-[#f0ede7]'
            }`}
          >
            {t}
            {t === 'Services' && config.services.length > 0 && (
              <span className={`ml-1.5 text-[10px] ${tab === t ? 'opacity-60' : 'opacity-40'}`}>{config.services.length}</span>
            )}
            {t === 'Agents' && config.agents.length > 0 && (
              <span className={`ml-1.5 text-[10px] ${tab === t ? 'opacity-60' : 'opacity-40'}`}>{config.agents.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'Services' && <ServicesTab services={config.services} capabilities={config.capabilities} agents={config.agents} />}
      {tab === 'Agents' && <AgentsTab agents={config.agents} />}
    </div>
  );
}
