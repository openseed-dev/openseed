/**
 * Janee process manager — spawns Janee as a child process (Authority mode).
 *
 * Auto-detects ~/.janee/config.yaml and starts Janee locally.
 * If no config exists, Janee is skipped — creatures fall back to raw env vars.
 *
 * With --runner-key, the Authority also exposes REST endpoints for Runners
 * inside creature containers to request exec grants.
 */
import { ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fsSync from 'node:fs';
import path from 'node:path';

const JANEE_PORT = parseInt(process.env.JANEE_PORT || '3100', 10);
const JANEE_HOME = process.env.JANEE_HOME || path.join(process.env.HOME || '/root', '.janee');
const IS_DOCKER = process.env.OPENSEED_DOCKER === '1' || process.env.ITSALIVE_DOCKER === '1';

let janeeProcess: ChildProcess | null = null;
let janeeAvailable = false;

const OPENSEED_HOME = process.env.OPENSEED_HOME || process.env.ITSALIVE_HOME || path.join(process.env.HOME || '/tmp', '.openseed');

function loadOrCreateRunnerKey(): string {
  if (process.env.JANEE_RUNNER_KEY) return process.env.JANEE_RUNNER_KEY;
  const keyPath = path.join(OPENSEED_HOME, 'runner-key');
  try {
    const existing = fsSync.readFileSync(keyPath, 'utf-8').trim();
    if (existing) return existing;
  } catch { /* doesn't exist yet */ }
  const key = randomUUID();
  try { fsSync.writeFileSync(keyPath, key + '\n', { mode: 0o600 }); } catch { /* best effort */ }
  return key;
}

const runnerKey = loadOrCreateRunnerKey();

/** Returns the Authority URL reachable from creature containers, or null if not running. */
export function getJaneeAuthorityUrl(): string | null {
  if (!janeeAvailable) return null;
  const host = IS_DOCKER ? 'openseed' : 'host.docker.internal';
  return `http://${host}:${JANEE_PORT}`;
}

/** Runner key shared between Authority and Runners inside containers. */
export function getJaneeRunnerKey(): string | null {
  if (!janeeAvailable) return null;
  return runnerKey;
}

async function waitForReady(maxAttempts = 20, intervalMs = 1000): Promise<boolean> {
  const healthUrl = `http://localhost:${JANEE_PORT}/v1/health`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

/** Start Janee if config exists. Returns true on success, false if skipped. */
export async function startJanee(): Promise<boolean> {
  const configPath = path.join(JANEE_HOME, 'config.yaml');
  if (!fsSync.existsSync(configPath)) {
    console.log('[janee] no config at', configPath, '— skipping');
    return false;
  }

  try {
    const bindHost = IS_DOCKER ? '0.0.0.0' : 'localhost';
    janeeProcess = spawn('npx', [
      '@true-and-useful/janee@latest', 'serve',
      '-t', 'http',
      '-p', String(JANEE_PORT),
      '--host', bindHost,
      '--runner-key', runnerKey,
    ], {
      env: { ...process.env, JANEE_HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    janeeProcess.stdout?.on('data', (d: Buffer) => {
      const line = d.toString().trim();
      if (line) console.log('[janee:out]', line);
    });
    janeeProcess.stderr?.on('data', (d: Buffer) => {
      const line = d.toString().trim();
      if (line) console.log('[janee:err]', line);
    });

    janeeProcess.on('error', (err) => {
      console.log('[janee] error:', err.message);
      janeeAvailable = false;
    });

    janeeProcess.on('exit', (code) => {
      console.log('[janee] exited with code', code);
      janeeAvailable = false;
      janeeProcess = null;
    });

    const ready = await waitForReady();
    if (ready) {
      janeeAvailable = true;
      console.log(`[janee] authority running on ${bindHost}:${JANEE_PORT}`);
      return true;
    }

    console.log('[janee] timed out waiting for readiness — creatures will use raw env vars');
    stopJanee();
    return false;
  } catch {
    console.log('[janee] failed to start — creatures will use raw env vars');
    stopJanee();
    return false;
  }
}

/** Stop Janee. */
export function stopJanee(): void {
  if (janeeProcess) {
    janeeProcess.kill('SIGTERM');
    janeeProcess = null;
  }
  janeeAvailable = false;
}
