/**
 * Per-creature API token authentication.
 *
 * Each creature gets a unique token at spawn time, injected as CREATURE_TOKEN.
 * Control endpoints require Bearer token auth. A creature's token only grants
 * access to its own control routes (self-management), preventing lateral movement.
 *
 * The dashboard (localhost) is exempt — it accesses the API directly without tokens.
 *
 * Closes #12
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** In-memory store: creature name → token */
const creatureTokens = new Map<string, string>();

/** Generate and store a token for a creature. Returns the token string. */
export function generateCreatureToken(name: string): string {
  const token = randomBytes(32).toString('hex');
  creatureTokens.set(name, token);
  return token;
}

/** Remove a creature's token (on destroy). */
export function revokeCreatureToken(name: string): void {
  creatureTokens.delete(name);
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

  // Find which creature this token belongs to
  let callerName: string | null = null;
  for (const [name, storedToken] of creatureTokens) {
    if (storedToken === token) {
      callerName = name;
      break;
    }
  }

  if (!callerName) {
    return { ok: false, status: 401, message: 'Invalid token.' };
  }

  // Creatures can only control themselves
  if (callerName !== targetCreature) {
    return {
      ok: false,
      status: 403,
      message: `Creature "${callerName}" cannot control "${targetCreature}". Self-management only.`,
    };
  }

  return { ok: true, caller: callerName };
}
