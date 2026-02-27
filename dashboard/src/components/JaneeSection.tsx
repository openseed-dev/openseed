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

// ── Permission state ──

function PermissionState({ agents, capName, onUpdate, knownAgents, defaultAccess }: {
  agents: string[];
  capName: string;
  onUpdate: (capName: string, agents: string[]) => void;
  knownAgents: string[];
  defaultAccess?: string;
}) {
  const [picking, setPicking] = useState(false);
  const hasAgents = agents.length > 0;
  const available = knownAgents.filter(a => !agents.includes(a));

  const addAgent = (agentId: string) => {
    if (!agentId || agents.includes(agentId)) return;
    onUpdate(capName, [...agents, agentId]);
    setPicking(false);
  };

  const removeAgent = (agent: string) => {
    onUpdate(capName, agents.filter(a => a !== agent));
  };

  const picker = available.length > 0 && (
    picking ? (
      <select
        autoFocus
        defaultValue=""
        onChange={e => { if (e.target.value) addAgent(e.target.value); }}
        onBlur={() => setPicking(false)}
        className="text-[11.5px] font-mono px-2 py-0.5 rounded border border-border-light bg-white focus:outline-none focus:border-text-primary/30 appearance-none"
      >
        <option value="" disabled>{hasAgents ? 'add creature…' : 'grant access to…'}</option>
        {available.map(a => <option key={a} value={a}>{a.replace('creature:', '')}</option>)}
      </select>
    ) : (
      <button
        onClick={() => setPicking(true)}
        className="text-[11.5px] text-text-faint hover:text-text-secondary transition-colors"
      >
        {hasAgents ? '+' : 'grant access…'}
      </button>
    )
  );

  if (!hasAgents) {
    const isRestricted = defaultAccess === 'restricted';
    return (
      <div className="flex items-center gap-2">
        <span className={`text-[12px] tracking-[-0.01em] ${isRestricted ? 'text-warn' : 'text-alive/70'}`}>
          {isRestricted ? 'No access' : 'All creatures'}
        </span>
        {picker}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {agents.map(a => (
        <span key={a} className="group/chip inline-flex items-center gap-0.5 text-[11.5px] font-mono bg-[#f0ede7] text-text-secondary px-2 py-0.5 rounded">
          {a.replace('creature:', '')}
          <button
            onClick={() => removeAgent(a)}
            className="opacity-0 group-hover/chip:opacity-100 ml-0.5 text-text-faint hover:text-error transition-all text-[13px] leading-none"
          >×</button>
        </span>
      ))}
      {picker}
    </div>
  );
}

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
    <div className="rounded-lg border border-border-default bg-surface p-5 flex flex-col gap-3">
      <div className="text-[11px] text-text-secondary tracking-[0.03em] uppercase">New service</div>
      <div className="flex gap-2.5">
        <input
          autoFocus
          placeholder="name"
          value={name}
          onChange={e => setName(e.target.value)}
          className="flex-1 text-[13.5px] px-3 py-2 rounded-md border border-border-light bg-bg focus:outline-none focus:border-text-primary/30 font-mono"
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <input
          placeholder="https://api.example.com"
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          className="flex-2 text-[13.5px] px-3 py-2 rounded-md border border-border-light bg-bg focus:outline-none focus:border-text-primary/30 font-mono"
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <select
          value={authType}
          onChange={e => setAuthType(e.target.value)}
          className="text-[13px] px-3 py-2 rounded-md border border-border-light bg-bg focus:outline-none appearance-none"
        >
          {AUTH_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="flex justify-end gap-2 mt-1">
        <button onClick={onCancel} disabled={busy} className="text-[13px] text-text-muted hover:text-text-primary px-3 py-1.5 transition-colors">Cancel</button>
        <button onClick={submit} disabled={busy || !name.trim() || !baseUrl.trim()} className="text-[13px] font-medium bg-text-primary text-white px-4 py-1.5 rounded-full disabled:opacity-30 transition-opacity">
          {busy ? 'Adding…' : 'Add service'}
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
    <div className="px-5 py-3.5 border-t border-border-light/60 bg-bg/50">
      <div className="flex gap-2.5 items-center">
        <input
          autoFocus
          placeholder="capability name"
          value={name}
          onChange={e => setName(e.target.value)}
          className="flex-1 text-[13px] px-2.5 py-1.5 rounded-md border border-border-light bg-white focus:outline-none focus:border-text-primary/30 font-mono"
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <input
          placeholder="1h"
          value={ttl}
          onChange={e => setTtl(e.target.value)}
          className="w-16 text-[13px] px-2.5 py-1.5 rounded-md border border-border-light bg-white focus:outline-none font-mono text-center"
        />
        <select
          value={mode}
          onChange={e => setMode(e.target.value)}
          className="text-[13px] px-2.5 py-1.5 rounded-md border border-border-light bg-white focus:outline-none appearance-none"
        >
          <option value="proxy">proxy</option>
          <option value="exec">exec</option>
        </select>
        <button onClick={submit} disabled={busy || !name.trim()} className="text-[12px] font-medium bg-text-primary text-white px-3 py-1.5 rounded-full disabled:opacity-30">
          {busy ? '…' : 'Add'}
        </button>
        <button onClick={onCancel} disabled={busy} className="text-[12px] text-text-muted hover:text-text-primary transition-colors">Cancel</button>
      </div>
    </div>
  );
}

// ── Display components ──

function CapRow({ cap, agents, onDelete, onUpdateAgents, knownAgents, defaultAccess }: {
  cap: MaskedCapability;
  agents: string[];
  onDelete: (name: string) => void;
  onUpdateAgents: (capName: string, agents: string[]) => void;
  knownAgents: string[];
  defaultAccess?: string;
}) {
  return (
    <div className="group flex items-center justify-between px-5 py-3 border-t border-border-light/50 hover:bg-bg/40 transition-colors gap-4">
      <div className="flex items-center gap-2.5 shrink-0">
        <span className="text-[13.5px] text-text-primary tracking-[-0.01em]">{cap.name}</span>
        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#f0ede7] text-text-muted">{cap.mode}</span>
        {cap.ttl && <span className="text-[11.5px] text-text-faint">{cap.ttl}</span>}
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <PermissionState agents={agents} capName={cap.name} onUpdate={onUpdateAgents} knownAgents={knownAgents} defaultAccess={defaultAccess} />
        <button
          onClick={() => onDelete(cap.name)}
          className="opacity-0 group-hover:opacity-100 text-[13px] text-text-faint hover:text-error transition-all leading-none ml-1 shrink-0"
          title="Delete capability"
        >×</button>
      </div>
    </div>
  );
}

function ServiceCard({ svc, caps, agentsByCap, onDeleteService, onDeleteCap, onAddCap, onUpdateAgents, knownAgents, defaultAccess }: {
  svc: MaskedService;
  caps: MaskedCapability[];
  agentsByCap: Map<string, string[]>;
  onDeleteService: (name: string) => void;
  onDeleteCap: (name: string) => void;
  onAddCap: (name: string, config: { service: string; ttl?: string; mode?: string }) => void;
  onUpdateAgents: (capName: string, agents: string[]) => void;
  knownAgents: string[];
  defaultAccess?: string;
}) {
  const [addingCap, setAddingCap] = useState(false);

  return (
    <div className="rounded-lg border border-border-light overflow-hidden">
      <div className="group flex items-center justify-between px-5 py-3.5 bg-surface border-b border-border-light/60">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <span className="text-[14.5px] font-semibold text-text-primary tracking-[-0.02em]">{svc.name}</span>
          <span className="text-[12px] font-mono text-text-muted truncate">{svc.baseUrl}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[10.5px] uppercase tracking-[0.05em] text-text-faint font-medium">
            {svc.authType}
          </span>
          <button
            onClick={() => onDeleteService(svc.name)}
            className="opacity-0 group-hover:opacity-100 text-[13px] text-text-faint hover:text-error transition-all leading-none"
            title="Delete service and its capabilities"
          >×</button>
        </div>
      </div>

      {caps.map(cap => (
        <CapRow
          key={cap.name}
          cap={cap}
          agents={agentsByCap.get(cap.name) || cap.allowedAgents || []}
          onDelete={onDeleteCap}
          onUpdateAgents={onUpdateAgents}
          knownAgents={knownAgents}
          defaultAccess={defaultAccess}
        />
      ))}

      {!caps.length && !addingCap && (
        <div className="px-5 py-3 text-[12.5px] text-text-faint italic">No capabilities defined</div>
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
          className="w-full px-5 py-2.5 text-[12.5px] text-text-faint hover:text-text-secondary hover:bg-bg/40 transition-colors border-t border-border-light/50 text-left"
        >
          + Add capability
        </button>
      )}
    </div>
  );
}

// ── Tabs ──

function ServicesTab({ services, capabilities, agents, onMutate, knownAgents, defaultAccess }: {
  services: MaskedService[];
  capabilities: MaskedCapability[];
  agents: AgentAccess[];
  onMutate: (fn: () => Promise<JaneeConfigView>) => void;
  knownAgents: string[];
  defaultAccess?: string;
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
    <div className="flex flex-col gap-3">
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
          knownAgents={knownAgents}
          defaultAccess={defaultAccess}
        />
      ))}

      {unbound.length > 0 && (
        <div className="rounded-lg border border-dashed border-border-light overflow-hidden">
          <div className="px-5 py-3 bg-bg border-b border-border-light/60">
            <span className="text-[11px] uppercase tracking-[0.04em] text-text-faint font-medium">Unbound capabilities</span>
          </div>
          {unbound.map(cap => (
            <CapRow
              key={cap.name}
              cap={cap}
              agents={agentsByCap.get(cap.name) || cap.allowedAgents || []}
              onDelete={handleDeleteCap}
              onUpdateAgents={handleUpdateAgents}
              knownAgents={knownAgents}
              defaultAccess={defaultAccess}
            />
          ))}
        </div>
      )}

      {addingService ? (
        <AddServiceForm onSubmit={handleAddService} onCancel={() => setAddingService(false)} />
      ) : (
        <button
          onClick={() => setAddingService(true)}
          className="self-start text-[13px] text-text-muted hover:text-text-primary transition-colors mt-1"
        >
          + Add service
        </button>
      )}

      {!services.length && !capabilities.length && !addingService && (
        <div className="py-10 text-center">
          <p className="text-[13.5px] text-text-muted">No services configured yet.</p>
          <p className="text-[12.5px] text-text-faint mt-1">Add a service to start managing API access.</p>
        </div>
      )}
    </div>
  );
}

function AgentsTab({ agents }: { agents: AgentAccess[] }) {
  if (!agents.length) {
    return (
      <div className="py-10 text-center">
        <p className="text-[13.5px] text-text-muted">No agent access rules yet.</p>
        <p className="text-[12.5px] text-text-faint mt-1">
          Restrict a capability to specific creatures in the Services tab.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      {agents.map(a => (
        <div key={a.agentId} className="rounded-lg border border-border-light px-5 py-3.5">
          <div className="text-[14px] font-medium text-text-primary mb-2.5">{a.agentId}</div>
          <div className="flex flex-wrap gap-2">
            {a.capabilities.map(s => (
              <span key={s} className="text-[11.5px] font-mono px-2.5 py-1 rounded bg-[#f0ede7] text-text-secondary">{s}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main ──

export function JaneeSection() {
  const [tab, setTab] = useState<Tab>('Services');
  const [config, setConfig] = useState<JaneeConfigView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [knownAgents, setKnownAgents] = useState<string[]>([]);

  useEffect(() => {
    api.fetchJaneeConfig()
      .then(setConfig)
      .catch(() => setError('Could not load Janee config. Is Janee running?'));
    api.fetchCreatures()
      .then(creatures => setKnownAgents(creatures.map(c => `creature:${c.name}`)))
      .catch(() => {});
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
    <div className={mutating ? 'opacity-60 pointer-events-none transition-opacity' : 'transition-opacity'}>
      <h3 className="text-[15px] font-semibold text-text-primary mb-1">Janee</h3>
      <p className="text-[12px] text-text-muted mb-6 leading-relaxed">
        Manage services, capabilities, and which creatures can use them.
      </p>

      {error && (
        <div className="text-[12.5px] text-error bg-error/5 border border-error/10 rounded-md px-3.5 py-2.5 mb-4">{error}</div>
      )}

      <div className="flex gap-1 mb-5">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-[13px] tracking-[-0.01em] rounded-full transition-all ${
              tab === t
                ? 'bg-text-primary text-white font-medium'
                : 'text-text-muted hover:text-text-primary hover:bg-bg'
            }`}
          >
            {t}
            {t === 'Services' && config.services.length > 0 && (
              <span className={`ml-1.5 text-[11px] ${tab === t ? 'opacity-50' : 'opacity-40'}`}>{config.services.length}</span>
            )}
            {t === 'Agents' && config.agents.length > 0 && (
              <span className={`ml-1.5 text-[11px] ${tab === t ? 'opacity-50' : 'opacity-40'}`}>{config.agents.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'Services' && <ServicesTab services={config.services} capabilities={config.capabilities} agents={config.agents} onMutate={onMutate} knownAgents={knownAgents} defaultAccess={config.server?.defaultAccess} />}
      {tab === 'Agents' && <AgentsTab agents={config.agents} />}
    </div>
  );
}
