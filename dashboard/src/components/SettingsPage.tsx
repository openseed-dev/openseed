import { useState, useEffect } from 'react';
import * as api from '@/api';
import type { JaneeConfigView, MaskedService, MaskedCapability, AgentAccess } from '@/types';
import { Badge } from '@/components/ui/badge';

const tabs = ['Services', 'Capabilities', 'Agents & Access'] as const;
type Tab = typeof tabs[number];

function AuthBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    bearer: 'bg-blue-50 text-blue-700 border-blue-200',
    'hmac-mexc': 'bg-amber-50 text-amber-700 border-amber-200',
    'hmac-bybit': 'bg-amber-50 text-amber-700 border-amber-200',
    'hmac-okx': 'bg-amber-50 text-amber-700 border-amber-200',
    headers: 'bg-gray-50 text-gray-700 border-gray-200',
    'service-account': 'bg-purple-50 text-purple-700 border-purple-200',
    'github-app': 'bg-green-50 text-green-700 border-green-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${colors[type] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
      {type}
    </span>
  );
}

function EmptyState({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="text-3xl mb-3">{icon}</span>
      <p className="text-[13px] font-medium text-text-secondary">{title}</p>
      <p className="text-[11px] text-text-muted mt-1 max-w-[300px]">{description}</p>
    </div>
  );
}

function ServicesTab({ services }: { services: MaskedService[] }) {
  if (services.length === 0) {
    return <EmptyState icon="🔐" title="No services configured" description="Add a service with `janee add` to see it here." />;
  }
  return (
    <div className="flex flex-col gap-2">
      {services.map(svc => (
        <div key={svc.name} className="bg-surface border border-border-light rounded-lg px-4 py-3 flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-text-primary">{svc.name}</span>
              <AuthBadge type={svc.authType} />
            </div>
            <span className="text-[11px] text-text-muted font-mono">{svc.baseUrl}</span>
          </div>
          {svc.ownership && (
            <div className="text-[10px] text-text-muted text-right">
              {svc.ownership.type === 'agent' && svc.ownership.agentId
                ? <>Created by <span className="font-medium">{svc.ownership.agentId}</span></>
                : 'CLI-created'}
              {svc.ownership.accessPolicy && (
                <div className="mt-0.5">{svc.ownership.accessPolicy}</div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CapabilitiesTab({ capabilities }: { capabilities: MaskedCapability[] }) {
  if (capabilities.length === 0) {
    return <EmptyState icon="⚡" title="No capabilities configured" description="Capabilities define what agents can do through each service." />;
  }

  // Group by service
  const grouped = new Map<string, MaskedCapability[]>();
  for (const cap of capabilities) {
    const key = cap.service || 'unbound';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(cap);
  }

  return (
    <div className="flex flex-col gap-4">
      {Array.from(grouped.entries()).map(([service, caps]) => (
        <div key={service}>
          <h4 className="text-[11px] uppercase tracking-[0.05em] text-text-muted mb-2 font-medium">{service}</h4>
          <div className="flex flex-col gap-2">
            {caps.map(cap => (
              <div key={cap.name} className="bg-surface border border-border-light rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[13px] font-semibold text-text-primary">{cap.name}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {cap.mode}
                  </Badge>
                  {cap.autoApprove && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-200 text-green-700">
                      auto-approve
                    </Badge>
                  )}
                  {cap.requiresReason && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-200 text-amber-700">
                      requires reason
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-4 text-[11px] text-text-muted">
                  <span>TTL: <span className="font-medium text-text-secondary">{cap.ttl || 'none'}</span></span>
                  {cap.allowedAgents && cap.allowedAgents.length > 0 && (
                    <span>Agents: <span className="font-medium text-text-secondary">{cap.allowedAgents.join(', ')}</span></span>
                  )}
                </div>
                {cap.rules && (cap.rules.allow?.length || cap.rules.deny?.length) ? (
                  <div className="mt-2 flex flex-col gap-1">
                    {cap.rules.allow?.map((r, i) => (
                      <span key={`a${i}`} className="text-[10px] font-mono text-green-700 bg-green-50 px-1.5 py-0.5 rounded inline-block w-fit">
                        ✓ {r}
                      </span>
                    ))}
                    {cap.rules.deny?.map((r, i) => (
                      <span key={`d${i}`} className="text-[10px] font-mono text-red-700 bg-red-50 px-1.5 py-0.5 rounded inline-block w-fit">
                        ✗ {r}
                      </span>
                    ))}
                  </div>
                ) : null}
                {cap.mode === 'exec' && cap.allowCommands?.length ? (
                  <div className="mt-2">
                    <span className="text-[10px] text-text-muted">Commands: </span>
                    {cap.allowCommands.map((cmd, i) => (
                      <span key={i} className="text-[10px] font-mono bg-gray-100 px-1.5 py-0.5 rounded mr-1 inline-block">
                        {cmd}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentsTab({ agents, defaultAccess }: { agents: AgentAccess[]; defaultAccess?: string }) {
  if (agents.length === 0) {
    return (
      <EmptyState
        icon="👤"
        title="No agent-specific access"
        description={`Default access: ${defaultAccess || 'open'}. All capabilities are available to any agent.`}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-text-muted mb-2">
        Default access: <span className="font-medium text-text-secondary">{defaultAccess || 'open'}</span>
      </p>
      {agents.map(agent => (
        <div key={agent.agentId} className="bg-surface border border-border-light rounded-lg px-4 py-3">
          <span className="text-[13px] font-semibold text-text-primary">{agent.agentId}</span>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {agent.capabilities.map(cap => (
              <Badge key={cap} variant="outline" className="text-[10px] px-1.5 py-0">
                {cap}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('Services');
  const [config, setConfig] = useState<JaneeConfigView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.fetchJaneeConfig()
      .then(setConfig)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex-1 min-w-0 flex flex-col h-screen">
      {/* Header */}
      <div className="border-b border-border-light px-6 py-4 flex items-center justify-between bg-surface">
        <div>
          <h1 className="text-[17px] font-semibold text-text-primary tracking-tight">Janee Configuration</h1>
          <p className="text-[11px] text-text-muted mt-0.5">Read-only view of services, capabilities, and access control.</p>
        </div>
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text-primary text-[20px] leading-none px-2 py-1 rounded hover:bg-gray-100 transition-colors"
        >
          ×
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-border-light px-6 flex gap-0 bg-surface">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-[12px] font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-text-primary text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <p className="text-[12px] text-text-muted">Loading configuration…</p>
        ) : !config?.available ? (
          <EmptyState
            icon="⚙️"
            title="Janee not configured"
            description="No config.yaml found. Run `janee init` to set up."
          />
        ) : (
          <>
            {tab === 'Services' && <ServicesTab services={config.services} />}
            {tab === 'Capabilities' && <CapabilitiesTab capabilities={config.capabilities} />}
            {tab === 'Agents & Access' && <AgentsTab agents={config.agents} defaultAccess={config.server?.defaultAccess} />}
          </>
        )}
      </div>
    </div>
  );
}
