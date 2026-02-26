export interface DependencyStatus {
  status: 'up' | 'down' | 'unknown';
  lastCheck: string;
  error?: string;
  version?: string;
}

export interface OrchestratorHealth {
  status: 'healthy' | 'degraded';
  dependencies: Record<string, DependencyStatus>;
}

// Host events (orchestrator interprets these)
export type HostEvent =
  | { t: string; type: "host.boot" }
  | { t: string; type: "host.spawn"; pid: number; sha: string }
  | { t: string; type: "host.promote"; sha: string }
  | { t: string; type: "host.rollback"; from: string; to: string; reason: string }
  | { t: string; type: "host.infra_failure"; reason: string }
  | { t: string; type: "orchestrator.status" } & OrchestratorHealth
  | { t: string; type: "budget.exceeded"; daily_spent: number; daily_cap: number }
  | { t: string; type: "budget.reset" };

// Universal creature lifecycle events (orchestrator interprets these)
export type CreatureLifecycleEvent =
  | { t: string; type: "creature.boot"; sha: string; janeeVersion?: string }
  | { t: string; type: "creature.thought"; text: string }
  | { t: string; type: "creature.sleep"; text: string; seconds: number; actions: number }
  | { t: string; type: "creature.tool_call"; tool: string; input: string; ok: boolean; output: string; ms: number }
  | { t: string; type: "creature.wake"; reason: string; source: "manual" | "timer" | "external" }
  | { t: string; type: "creature.message"; text: string; source: "user" | "system" }
  | { t: string; type: "creature.error"; error: string; retryIn?: number; retries?: number; fatal?: boolean }
  | { t: string; type: "creature.request_restart"; reason: string }
  | { t: string; type: "creature.spawning" }
  | { t: string; type: "creature.spawned" }
  | { t: string; type: "creature.spawn_failed"; error: string };

// Genome-specific events. The host relays these but doesn't interpret them.
// Genomes can emit any event type with any fields.
export type GenomeEvent = { t: string; type: string; [key: string]: unknown };

export type Event = HostEvent | CreatureLifecycleEvent | GenomeEvent;

export interface HostStatus {
  current_sha: string;
  last_good_sha: string;
  pid: number | null;
  healthy: boolean;
}
