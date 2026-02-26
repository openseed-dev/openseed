/**
 * Read-only access to Janee config.yaml for the dashboard.
 * Masks all secrets/keys before returning.
 */
import fs from 'node:fs';
import path from 'node:path';
import jsYaml from 'js-yaml';

const JANEE_HOME = process.env.JANEE_HOME || path.join(process.env.HOME || '/root', '.janee');

interface MaskedService {
  name: string;
  baseUrl: string;
  authType: string;
  ownership?: { type: string; agentId?: string; accessPolicy?: string };
}

interface MaskedCapability {
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

interface AgentAccess {
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

export function readJaneeConfig(): JaneeConfigView {
  const configPath = path.join(JANEE_HOME, 'config.yaml');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = jsYaml.load(raw);
    return parseConfig(parsed);
  } catch {
    return { available: false, services: [], capabilities: [], agents: [] };
  }
}

function parseConfig(config: any): JaneeConfigView {
  if (!config || typeof config !== 'object') {
    return { available: false, services: [], capabilities: [], agents: [] };
  }

  const services: MaskedService[] = [];
  if (config.services && typeof config.services === 'object') {
    for (const [name, svc] of Object.entries(config.services as Record<string, any>)) {
      services.push({
        name,
        baseUrl: svc.baseUrl || '',
        authType: svc.auth?.type || 'unknown',
        ownership: svc.ownership ? {
          type: svc.ownership.type || 'cli',
          agentId: svc.ownership.agentId,
          accessPolicy: svc.ownership.accessPolicy,
        } : undefined,
      });
    }
  }

  const capabilities: MaskedCapability[] = [];
  if (config.capabilities && typeof config.capabilities === 'object') {
    for (const [name, cap] of Object.entries(config.capabilities as Record<string, any>)) {
      capabilities.push({
        name,
        service: cap.service || '',
        mode: cap.mode || 'proxy',
        ttl: cap.ttl || '',
        requiresReason: !!cap.requiresReason,
        rules: cap.rules ? {
          allow: cap.rules.allow || [],
          deny: cap.rules.deny || [],
        } : undefined,
        allowedAgents: cap.allowedAgents,
        allowCommands: cap.allowCommands,
        workDir: cap.workDir,
        timeout: cap.timeout,
      });
    }
  }

  // Derive agent access from capabilities
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
      port: config.server.port || 3100,
      host: config.server.host || 'localhost',
      defaultAccess: config.server.defaultAccess,
    } : undefined,
    services,
    capabilities,
    agents,
  };
}
