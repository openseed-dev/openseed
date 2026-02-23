/**
 * Per-creature API token authentication.
 *
 * Each creature gets a unique token derived deterministically from
 * HMAC(orchestrator_secret, creature_name). This means:
 * - Tokens survive orchestrator restarts (same secret → same tokens)
 * - No persistence layer needed for tokens
 * - Creatures still receive tokens at spawn time via CREATURE_TOKEN env var
 *
 * The orchestrator secret is read from OPENSEED_SECRET env var or auto-generated
 * and written to ~/.openseed/secret on first run.
 *
 * Closes #12
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IncomingMessage } from 'node:http';

/** Cached orchestrator secret. */
let orchestratorSecret: string | null = null;

/** Derived token cache: creature name → token (avoids re-deriving on every auth check). */
const tokenCache = new Map<string, string>();

/** Constant-time string comparison (prevents timing attacks). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Get (or create) the orchestrator secret.
 * Priority: OPENSEED_SECRET env var > ~/.openseed/secret file > auto-generate.
 */
function getOrchestratorSecret(): string {
  if (orchestratorSecret) return orchestratorSecret;

  // 1. Check env var
  if (process.env.OPENSEED_SECRET) {
    orchestratorSecret = process.env.OPENSEED_SECRET;
    return orchestratorSecret;
  }

  // 2. Check persisted secret file
  const secretDir = join(homedir(), '.openseed');
  const secretPath = join(secretDir, 'secret');

  if (existsSync(secretPath)) {
    orchestratorSecret = readFileSync(secretPath, 'utf-8').trim();
    return orchestratorSecret;
  }

  // 3. Generate and persist
  orchestratorSecret = randomBytes(32).toString('hex');
  mkdirSync(secretDir, { recursive: true });
  writeFileSync(secretPath, orchestratorSecret, { mode: 0o600 });
  return orchestratorSecret;
}

/**
 * Derive a deterministic token for a creature.
 * HMAC-SHA256(orchestrator_secret, creature_name) → hex string.
 */
export function deriveCreatureToken(name: string): string {
  const cached = tokenCache.get(name);
  if (cached) return cached;

  const secret = getOrchestratorSecret();
  const token = createHmac('sha256', secret).update(name).digest('hex');
  tokenCache.set(name, token);
  return token;
}

/** Remove a creature's cached token (on destroy). */
export function revokeCreatureToken(name: string): void {
  tokenCache.delete(name);
}

/** Check if a request is from localhost (dashboard). */
function isLocalhost(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * Authenticate a creature control request.
 *
 * Returns { ok: true, caller } on success, or { ok: false, status, message } on failure.
 *
 * Rules:
 * - Localhost requests (dashboard) are always allowed
 * - Remote requests must provide Bearer token
 * - Token must match the target creature (self-management only)
 */
export function authenticateCreatureRequest(
  req: IncomingMessage,
  targetCreature: string,
): { ok: true; caller: string } | { ok: false; status: number; message: string } {
  // Dashboard access from localhost is always allowed
  if (isLocalhost(req)) {
    return { ok: true, caller: 'dashboard' };
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      status: 401,
      message: 'Authentication required. Provide Bearer token via Authorization header.',
    };
  }

  const token = authHeader.slice(7);

  // Re-derive the expected token for the target creature directly.
  // This avoids relying on the token cache (which is empty after orchestrator restart)
  // and eliminates the O(n) cache scan.
  const expected = deriveCreatureToken(targetCreature);

  if (!safeEqual(expected, token)) {
    return { ok: false, status: 401, message: 'Invalid token.' };
  }

  return { ok: true, caller: targetCreature };
}
