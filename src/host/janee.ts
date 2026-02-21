/**
 * Janee process manager — spawns Janee as a child process.
 *
 * Auto-detects ~/.janee/config.yaml and starts Janee locally.
 * If no config exists, Janee is skipped — creatures fall back to raw env vars.
 */
import { ChildProcess, spawn } from 'node:child_process';
import fsSync from 'node:fs';
import path from 'node:path';

const JANEE_PORT = parseInt(process.env.JANEE_PORT || '3100', 10);
const JANEE_HOME = process.env.JANEE_HOME || path.join(process.env.HOME || '/root', '.janee');
const IS_DOCKER = process.env.OPENSEED_DOCKER === '1' || process.env.ITSALIVE_DOCKER === '1';

let janeeProcess: ChildProcess | null = null;
let janeeAvailable = false;

/** Returns the Janee URL reachable from creature containers, or null if not running. */
export function getJaneeUrl(): string | null {
  if (!janeeAvailable) return null;
  const host = IS_DOCKER ? 'openseed' : 'host.docker.internal';
  return `http://${host}:${JANEE_PORT}`;
}

async function waitForReady(maxAttempts = 10, intervalMs = 1000): Promise<boolean> {
  // Don't call initialize here — the SDK only allows one session per transport,
  // and using it for a health check would consume the creature's session slot.
  // Instead, send a POST without a valid method; any non-network-error response
  // means the server is alive and accepting connections.
  const localUrl = `http://localhost:${JANEE_PORT}/mcp`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(localUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' }),
        signal: AbortSignal.timeout(2000),
      });
      // Any HTTP response (even 4xx) means the server is running
      return true;
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
      '@true-and-useful/janee', 'serve',
      '-t', 'http',
      '-p', String(JANEE_PORT),
      '--host', bindHost,
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
      console.log(`[janee] running on ${bindHost}:${JANEE_PORT}`);
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
