/**
 * Dependency health tracker for the orchestrator.
 *
 * Periodically checks Docker and Janee availability.
 * Fires onChange when a dependency transitions state.
 * Exposes getStatus() used to gate creature operations.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { DependencyStatus, OrchestratorHealth } from '../shared/types.js';

const execAsync = promisify(exec);
const JANEE_PORT = parseInt(process.env.JANEE_PORT || '3100', 10);

const deps: Record<string, DependencyStatus> = {
  docker: { status: 'unknown', lastCheck: new Date().toISOString() },
  janee: { status: 'unknown', lastCheck: new Date().toISOString() },
};

let healthInterval: NodeJS.Timeout | null = null;
let checkInFlight = false;
const changeListeners = new Set<(health: OrchestratorHealth) => void>();

export async function checkDocker(): Promise<DependencyStatus> {
  const now = new Date().toISOString();
  try {
    await execAsync('docker info', { timeout: 5000 });
    return { status: 'up', lastCheck: now };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'down', lastCheck: now, error: msg.slice(0, 200) };
  }
}

export async function checkJanee(): Promise<DependencyStatus> {
  const now = new Date().toISOString();
  try {
    const res = await fetch(`http://localhost:${JANEE_PORT}/v1/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return { status: 'down', lastCheck: now, error: `HTTP ${res.status}` };
    }
    const body = await res.json() as Record<string, unknown>;
    const version = typeof body.version === 'string' ? body.version : undefined;
    return { status: 'up', lastCheck: now, version };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'down', lastCheck: now, error: msg.slice(0, 200) };
  }
}

async function runAllChecks() {
  // Skip if a previous check is still running (e.g. docker info near its 5s timeout)
  if (checkInFlight) return;
  checkInFlight = true;

  try {
    const prevStatus = getStatus().status;

    deps.docker = await checkDocker();
    deps.janee = await checkJanee();

    const newStatus = getStatus().status;
    if (newStatus !== prevStatus) {
      const health = getStatus();
      for (const cb of changeListeners) cb(health);
    }
  } finally {
    checkInFlight = false;
  }
}

export function getStatus(): OrchestratorHealth {
  const allUp = Object.values(deps).every(d => d.status === 'up');
  return {
    status: allUp ? 'healthy' : 'degraded',
    // Deep-copy each dependency so callers get a stable snapshot
    dependencies: Object.fromEntries(
      Object.entries(deps).map(([k, v]) => [k, { ...v }]),
    ),
  };
}

export function getDependency(name: string): DependencyStatus | undefined {
  return deps[name];
}

export function onStatusChange(cb: (health: OrchestratorHealth) => void): () => void {
  changeListeners.add(cb);
  return () => { changeListeners.delete(cb); };
}

export async function startHealthLoop(intervalMs = 15_000): Promise<() => void> {
  await runAllChecks();

  healthInterval = setInterval(runAllChecks, intervalMs);

  return () => {
    if (healthInterval) {
      clearInterval(healthInterval);
      healthInterval = null;
    }
  };
}

export function stopHealthLoop() {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}
