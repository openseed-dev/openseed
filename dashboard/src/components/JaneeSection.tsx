import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import * as api from '@/api';
import type {
  AgentAccess,
  JaneeConfigView,
  MaskedCapability,
  MaskedService,
} from '@/types';

const tabs = ['Services', 'Agents'] as const;
type Tab = typeof tabs[number];

const AUTH_TYPES = ['bearer', 'headers', 'hmac-mexc', 'hmac-bybit', 'hmac-okx', 'service-account', 'github-app'] as const;

// ── Inline forms ──

function AddServiceForm({ onSubmit, onCancel }: {
  onSubmit: (name: string, baseUrl: string, authType: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [authType, setAuthType] = useState<string>('bearer');
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (!name.trim() || !baseUrl.trim()) return;
    setBusy(true);
    onSubmit(name.trim(), baseUrl.trim(), authType);
  };

  return (
    <div className="rounded-lg border border-text-primary/20 bg-[#fdfcfa] p-4 flex flex-col gap-3">
      <div className="text-[11px] uppercase tracking-[0.06em] text-text-faint font-medium">New service</div>
      <div className="flex gap-2">
        <input
          autoFocus
          placeholder="name"
          value={name}
          onChange={e => setName(e.target.value)}
          className="flex-1 text-[12.5px] px-2.5 py-1.5 rounded border border-border-light bg-white focus:outline-none focus:border-text-primary/40 font-mono"
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <input
          placeholder="https://api.example.com"
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          className="flex-2 text-[12.5px] px-2.5 py-1.5 rounded border border-border-light bg-white focus:outline-none focus:border-text-primary/40 font-mono"
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <select
          value={authType}
          onChange={e => setAuthType(e.target.value)}
          className="text-[12px] px-2 py-1.5 rounded border border-border-light bg-white focus:outline-none"
        >
          {AUTH_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={busy} className="text-[11px] text-text-muted hover:text-text-primary px-3 py-1">Cancel</button>
        <button onClick={submit} disabled={busy || !name.trim() || !baseUrl.trim()} className="text-[11px] font-medium bg-text-primary text-white px-3 py-1.5 rounded-full disabled:opacity-40">
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  );
}

function AddCapabilityForm({ serviceName, onSubmit, onCancel }: {
  serviceName: string;
  onSubmit: (name: string, config: { service: string; ttl?: string; mode?: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [ttl, setTtl] = useState('1h');
  const [mode, setMode] = useState('proxy');
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (!name.trim()) return;
    setBusy(true);
    onSubmit(name.trim(), { service: serviceName, ttl, mode });
  };

  return (
    <div className="px-4 py-3 border-t border-border-light/60 bg-[#faf9f6]">
      <div className="flex gap-2 items-center">
        <input
          autoFocus
          placeholder="capability name"
          value={name}
          onChange={e => setName(e.target.value)}
          className="flex-1 text-[12px] px-2 py-1 rounded border border-border-light bg-white focus:outline-none focus:border-text-primary/40 font-mono"
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <input
          placeholder="1h"
          value={ttl}
          onChange={e => setTtl(e.target.value)}
          className="w-16 text-[12px] px-2 py-1 rounded border border-border-light bg-white focus:outline-none font-mono"
        />
        <select
          value={mode}
          onChange={e => setMode(e.target.value)}
          className="text-[11px] px-2 py-1 rounded border border-border-light bg-white focus:outline-none"
        >
          <option value="proxy">proxy</option>
          <option value="exec">exec</option>
        </select>
        <button onClick={submit} disabled={busy || !name.trim()} className="text-[10.5px] font-medium bg-text-primary text-white px-2.5 py-1 rounded-full disabled:opacity-40">
          {busy ? '…' : 'Add'}
        </button>
        <button onClick={onCancel} disabled={busy} className="text-[10.5px] text-text-muted hover:text-text-primary">Cancel</button>
      </div>
    </div>
  );
}

function AgentChips({ agents, capName, onUpdate }: {
  agents: string[];
  capName: string;
  onUpdate: (capName: string, agents: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');

  const remove = (agent: string) => {
    onUpdate(capName, agents.filter(a => a !== agent));
  };

  const add = () => {
    const v = value.trim();
    if (!v || agents.includes(v)) return;
    onUpdate(capName, [...agents, v]);
    setValue('');
    setAdding(false);
  };

  return (
    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
      <span className="text-[9px] uppercase tracking-[0.06em] text-text-faint mr-0.5">access</span>
      {agents.map(a => (
        <span key={a} className="group/chip inline-flex items-center gap-1 text-[10px] font-mono text-text-muted">
          {a}
          <button
            onClick={() => remove(a)}
            className="opacity-0 group-hover/chip:opacity-100 text-[9px] text-red-400 hover:text-red-600 transition-opacity"
            title="Remove agent"
          >×</button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false); }}
          onBlur={() => { if (!value.trim()) setAdding(false); }}
          placeholder="agent-id"
          className="text-[10px] font-mono w-24 px-1.5 py-0.5 rounded border border-border-light bg-white focus:outline-none focus:border-text-primary/40"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-[10px] text-text-faint hover:text-text-primary transition-colors"
          title="Add agent"
        >+</button>
      )}
    </div>
  );
}

// ── Display components ──

function CapRow({ cap, agents, onDelete, onUpdateAgents }: {
  cap: MaskedCapability;
  agents: string[];
  onDelete: (name: string) => void;
  onUpdateAgents: (capName: string, agents: string[]) => void;
}) {
  return (
    <div className="group px-4 py-2.5 border-t border-border-light/60 hover:bg-[#faf9f6] transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-[12.5px] text-text-primary tracking-[-0.01em]">{cap.name}</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm bg-[#f0ede7] text-text-secondary">{cap.mode}</span>
          {cap.ttl && <span className="text-[10px] text-text-faint">{cap.ttl}</span>}
        </div>
        <button
          onClick={() => onDelete(cap.name)}
          className="opacity-0 group-hover:opacity-100 text-[10px] text-red-400 hover:text-red-600 transition-opacity"
          title="Delete capability"
        >×</button>
      </div>
      <AgentChips agents={agents} capName={cap.name} onUpdate={onUpdateAgents} />
    </div>
  );
}

function ServiceCard({ svc, caps, agentsByCap, onDeleteService, onDeleteCap, onAddCap, onUpdateAgents }: {
  svc: MaskedService;
  caps: MaskedCapability[];
  agentsByCap: Map<string, string[]>;
  onDeleteService: (name: string) => void;
  onDeleteCap: (name: string) => void;
  onAddCap: (name: string, config: { service: string; ttl?: string; mode?: string }) => void;
  onUpdateAgents: (capName: string, agents: string[]) => void;
}) {
  const [addingCap, setAddingCap] = useState(false);

  return (
    <div className="rounded-lg border border-border-light overflow-hidden">
      <div className="group flex items-center justify-between px-4 py-3 bg-[#fdfcfa] border-b border-border-light/60">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-text-primary">{svc.name}</span>
          <span className="text-[10.5px] font-mono text-text-muted truncate max-w-[200px]">{svc.baseUrl}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9.5px] uppercase tracking-[0.05em] text-text-faint font-medium">
            {svc.authType}
          </span>
          <button
            onClick={() => onDeleteService(svc.name)}
            className="opacity-0 group-hover:opacity-100 text-[10px] text-red-400 hover:text-red-600 transition-opacity"
            title="Delete service"
          >×</button>
        </div>
      </div>
      {caps.length > 0 ? (
        caps.map(cap => (
          <CapRow
            key={cap.name}
            cap={cap}
            agents={agentsByCap.get(cap.name) || cap.allowedAgents || []}
            onDelete={onDeleteCap}
            onUpdateAgents={onUpdateAgents}
          />
        ))
      ) : (
        <div className="px-4 py-3 text-[11px] text-text-faint italic">No capabilities</div>
      )}
      {addingCap ? (
        <AddCapabilityForm
          serviceName={svc.name}
          onSubmit={(name, config) => { onAddCap(name, config); setAddingCap(false); }}
          onCancel={() => setAddingCap(false)}
        />
      ) : (
        <button
          onClick={() => setAddingCap(true)}
          className="w-full px-4 py-2 text-[10.5px] text-text-faint hover:text-text-primary hover:bg-[#faf9f6] transition-colors border-t border-border-light/60 text-left"
        >
          + Add capability
        </button>
      )}
    </div>
  );
}

function ServicesTab({ services, capabilities, agents, onMutate }: {
  services: MaskedService[];
  capabilities: MaskedCapability[];
  agents: AgentAccess[];
  onMutate: (fn: () => Promise<JaneeConfigView>) => void;
}) {
  const [addingService, setAddingService] = useState(false);

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

  const handleAddService = (name: string, baseUrl: string, authType: string) => {
    onMutate(() => api.addJaneeService(name, baseUrl, authType));
    setAddingService(false);
  };

  const handleDeleteService = (name: string) => {
    if (!confirm(`Delete service "${name}" and all its capabilities?`)) return;
    onMutate(() => api.deleteJaneeService(name));
  };

  const handleDeleteCap = (name: string) => {
    if (!confirm(`Delete capability "${name}"?`)) return;
    onMutate(() => api.deleteJaneeCapability(name));
  };

  const handleAddCap = (name: string, config: { service: string; ttl?: string; mode?: string }) => {
    onMutate(() => api.addJaneeCapability(name, config));
  };

  const handleUpdateAgents = (capName: string, newAgents: string[]) => {
    onMutate(() => api.updateCapabilityAgents(capName, newAgents));
  };

  return (
    <div className="flex flex-col gap-2.5">
      {addingService ? (
        <AddServiceForm onSubmit={handleAddService} onCancel={() => setAddingService(false)} />
      ) : (
        <button
          onClick={() => setAddingService(true)}
          className="self-start text-[11px] text-text-muted hover:text-text-primary transition-colors mb-1"
        >
          + Add service
        </button>
      )}

      {services.map(svc => (
        <ServiceCard
          key={svc.name}
          svc={svc}
          caps={capsByService.get(svc.name) || []}
          agentsByCap={agentsByCap}
          onDeleteService={handleDeleteService}
          onDeleteCap={handleDeleteCap}
          onAddCap={handleAddCap}
          onUpdateAgents={handleUpdateAgents}
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
              onDelete={handleDeleteCap}
              onUpdateAgents={handleUpdateAgents}
            />
          ))}
        </div>
      )}

      {!services.length && !capabilities.length && !addingService && (
        <div className="py-8 text-center">
          <p className="text-[12px] text-text-muted">No services configured.</p>
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
        <p className="text-[11px] text-text-faint mt-1">Grant access via capability settings in the Services tab.</p>
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
  const [mutating, setMutating] = useState(false);

  useEffect(() => {
    api.fetchJaneeConfig()
      .then(setConfig)
      .catch(() => setError('Could not load Janee config. Is Janee running?'));
  }, []);

  const onMutate = useCallback((fn: () => Promise<JaneeConfigView>) => {
    setMutating(true);
    setError(null);
    fn()
      .then(setConfig)
      .catch(e => setError(e.message))
      .finally(() => setMutating(false));
  }, []);

  if (error && !config) {
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
    <div className={mutating ? 'opacity-70 pointer-events-none' : ''}>
      <h3 className="text-[15px] font-semibold text-text-primary mb-1">Janee</h3>
      <p className="text-[12px] text-text-muted mb-5 leading-relaxed">
        Services, capabilities &amp; agent access for <code className="font-mono bg-[#f0ede7] px-1.5 py-0.5 rounded-sm text-[10.5px]">~/.janee/config.yaml</code>
      </p>

      {error && (
        <div className="text-[11px] text-red-500 bg-red-50 rounded px-3 py-2 mb-3">{error}</div>
      )}

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

      {tab === 'Services' && <ServicesTab services={config.services} capabilities={config.capabilities} agents={config.agents} onMutate={onMutate} />}
      {tab === 'Agents' && <AgentsTab agents={config.agents} />}
    </div>
  );
}
