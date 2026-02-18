/**
 * Lightweight Janee process manager for native (non-Docker) mode.
 *
 * When the orchestrator runs natively, this module auto-detects a local
 * Janee configuration (~/.janee/config.yaml) and spawns Janee as a child
 * process. If no config exists, Janee is silently skipped — creatures
 * fall back to raw environment variables.
 *
 * In Docker mode, Janee runs as a separate container (see docker-compose.yml)
 * and this module is not used.
 */
import { ChildProcess, spawn } from 'node:child_process';
import fsSync from 'node:fs';
import path from 'node:path';

const JANEE_PORT = parseInt(process.env.JANEE_PORT || '3100', 10);
const JANEE_HOME = process.env.JANEE_HOME || path.join(process.env.HOME || '/tmp', '.janee');

let janeeProcess: ChildProcess | null = null;
let janeeAvailable = false;

/**
 * Returns the URL for the locally-managed Janee instance, or null if
 * Janee is not available.
 */
export function getJaneeUrl(): string | null {
  if (!janeeAvailable) return null;
  return `http://localhost:${JANEE_PORT}`;
}

/**
 * Attempt to start a local Janee instance. Returns true if Janee started
 * successfully, false if skipped or failed (non-fatal either way).
 */
export async function startJanee(): Promise<boolean> {
  const configPath = path.join(JANEE_HOME, 'config.yaml');
  if (!fsSync.existsSync(configPath)) {
    console.log('[janee] No config found at', configPath, '— skipping. Creatures will use raw env vars.');
    return false;
  }

  try {
    janeeProcess = spawn('npx', ['@true-and-useful/janee', 'serve', '--http', String(JANEE_PORT)], {
      env: { ...process.env, JANEE_HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    janeeProcess.on('error', (err) => {
      console.log('[janee] Process error:', err.message);
      janeeAvailable = false;
    });

    janeeProcess.on('exit', (code) => {
      console.log('[janee] Process exited with code', code);
      janeeAvailable = false;
      janeeProcess = null;
    });

    // Wait for startup
    await new Promise(r => setTimeout(r, 3000));

    const res = await fetch(`http://localhost:${JANEE_PORT}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping', params: {} }),
      signal: AbortSignal.timeout(3000),
    });

    janeeAvailable = true;
    console.log(`[janee] Started on port ${JANEE_PORT}`);
    return true;
  } catch {
    console.log('[janee] Failed to start — creatures will use raw env vars.');
    stopJanee();
    return false;
  }
}

/**
 * Stop the local Janee process if running.
 */
export function stopJanee(): void {
  if (janeeProcess) {
    janeeProcess.kill('SIGTERM');
    janeeProcess = null;
  }
  janeeAvailable = false;
}
