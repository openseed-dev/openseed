/**
 * Janee config access layer for the dashboard.
 * Uses Janee's own library for read/write, masks secrets before returning.
 */
import {
  loadYAMLConfig,
  saveYAMLConfig,
  hasYAMLConfig,
  addServiceYAML,
  addCapabilityYAML,
  type JaneeYAMLConfig,
  type ServiceConfig,
  type CapabilityConfig,
  type AuthConfig,
} from '@true-and-useful/janee';

// ── Public view types (sent to dashboard, secrets stripped) ──

export interface MaskedService {
  name: string;
  baseUrl: string;
  authType: string;
  ownership?: { type: string; agentId?: string; accessPolicy?: string };
}

export interface MaskedCapability {
  name: string;
  service: string;
  mode: string;
  ttl: string;
  requiresReason: boolean;
  rules?: { allow?: string[]; deny?: string[] };
  allowedAgents?: string[];
  allowCommands?: string[];
  workDir?: string;
  timeout?: number;
}

export interface AgentAccess {
  agentId: string;
  capabilities: string[];
}

export interface JaneeConfigView {
  available: boolean;
  server?: { port: number; host: string; defaultAccess?: string };
  services: MaskedService[];
  capabilities: MaskedCapability[];
  agents: AgentAccess[];
}

const EMPTY: JaneeConfigView = { available: false, services: [], capabilities: [], agents: [] };

// ── Read (mask secrets) ──

function maskConfig(config: JaneeYAMLConfig): JaneeConfigView {
  const services: MaskedService[] = Object.entries(config.services).map(([name, svc]) => ({
    name,
    baseUrl: svc.baseUrl,
    authType: svc.auth.type,
    ownership: svc.ownership ? {
      type: svc.ownership.accessPolicy || 'all-agents',
      agentId: svc.ownership.createdBy,
      accessPolicy: svc.ownership.accessPolicy,
    } : undefined,
  }));

  const capabilities: MaskedCapability[] = Object.entries(config.capabilities).map(([name, cap]) => ({
    name,
    service: cap.service,
    mode: cap.mode || 'proxy',
    ttl: cap.ttl,
    requiresReason: !!cap.requiresReason,
    rules: cap.rules ? { allow: cap.rules.allow || [], deny: cap.rules.deny || [] } : undefined,
    allowedAgents: cap.allowedAgents,
    allowCommands: cap.allowCommands,
    workDir: cap.workDir,
    timeout: cap.timeout,
  }));

  const agentMap = new Map<string, string[]>();
  for (const cap of capabilities) {
    if (cap.allowedAgents) {
      for (const agent of cap.allowedAgents) {
        if (!agentMap.has(agent)) agentMap.set(agent, []);
        agentMap.get(agent)!.push(cap.name);
      }
    }
  }
  const agents: AgentAccess[] = Array.from(agentMap.entries()).map(([agentId, caps]) => ({
    agentId,
    capabilities: caps,
  }));

  return {
    available: true,
    server: config.server ? {
      port: config.server.port,
      host: config.server.host,
      defaultAccess: config.server.defaultAccess,
    } : undefined,
    services,
    capabilities,
    agents,
  };
}

export function readJaneeConfig(): JaneeConfigView {
  try {
    if (!hasYAMLConfig()) return EMPTY;
    return maskConfig(loadYAMLConfig());
  } catch {
    return EMPTY;
  }
}

// ── Mutations (all return fresh masked view) ──

function loadConfig(): JaneeYAMLConfig {
  return loadYAMLConfig();
}

export function addService(name: string, baseUrl: string, auth: AuthConfig): JaneeConfigView {
  addServiceYAML(name, baseUrl, auth);
  return readJaneeConfig();
}

export function updateService(name: string, patch: { baseUrl?: string; authType?: AuthConfig['type'] }): JaneeConfigView {
  const config = loadConfig();
  const svc = config.services[name];
  if (!svc) throw new Error(`Service "${name}" not found`);
  if (patch.baseUrl !== undefined) svc.baseUrl = patch.baseUrl;
  if (patch.authType !== undefined) svc.auth.type = patch.authType;
  saveYAMLConfig(config);
  return readJaneeConfig();
}

export function deleteService(name: string): JaneeConfigView {
  const config = loadConfig();
  if (!config.services[name]) throw new Error(`Service "${name}" not found`);
  delete config.services[name];
  // Remove capabilities that referenced this service
  for (const [capName, cap] of Object.entries(config.capabilities)) {
    if (cap.service === name) delete config.capabilities[capName];
  }
  saveYAMLConfig(config);
  return readJaneeConfig();
}

export function addCapability(name: string, capConfig: CapabilityConfig): JaneeConfigView {
  addCapabilityYAML(name, capConfig);
  return readJaneeConfig();
}

export function updateCapability(name: string, patch: Partial<CapabilityConfig>): JaneeConfigView {
  const config = loadConfig();
  const cap = config.capabilities[name];
  if (!cap) throw new Error(`Capability "${name}" not found`);
  Object.assign(cap, patch);
  saveYAMLConfig(config);
  return readJaneeConfig();
}

export function deleteCapability(name: string): JaneeConfigView {
  const config = loadConfig();
  if (!config.capabilities[name]) throw new Error(`Capability "${name}" not found`);
  delete config.capabilities[name];
  saveYAMLConfig(config);
  return readJaneeConfig();
}

export function updateCapabilityAgents(capName: string, agents: string[]): JaneeConfigView {
  const config = loadConfig();
  const cap = config.capabilities[capName];
  if (!cap) throw new Error(`Capability "${capName}" not found`);
  cap.allowedAgents = agents.length > 0 ? agents : undefined;
  saveYAMLConfig(config);
  return readJaneeConfig();
}
