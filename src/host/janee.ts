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

let janeeProcess: ChildProcess | null = null;
let janeeAvailable = false;

/** Returns the Janee URL if running, null otherwise. */
export function getJaneeUrl(): string | null {
  return janeeAvailable ? `http://localhost:${JANEE_PORT}` : null;
}

/** Start Janee if config exists. Returns true on success, false if skipped. */
export async function startJanee(): Promise<boolean> {
  const configPath = path.join(JANEE_HOME, 'config.yaml');
  if (!fsSync.existsSync(configPath)) {
    console.log('[janee] no config at', configPath, '— skipping');
    return false;
  }

  try {
    janeeProcess = spawn('npx', ['@true-and-useful/janee', 'serve', '--http', String(JANEE_PORT)], {
      env: { ...process.env, JANEE_HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
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

    await new Promise(r => setTimeout(r, 3000));
    janeeAvailable = true;
    console.log(`[janee] running on port ${JANEE_PORT}`);
    return true;
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
