/**
 * Janee Integration for OpenSeed
 *
 * Optional secrets management via Janee MCP server.
 * When enabled, API keys are fetched from Janee instead of environment variables,
 * giving per-creature audit trails, access policies, and instant revocation.
 *
 * @see https://github.com/rsdouglas/janee
 */

interface JaneeSession {
  sessionId: string;
  expiresAt: number;
  service: string;
}

interface JaneeConfig {
  /** Janee HTTP endpoint (default: http://janee:9100 in Docker, http://localhost:9100 otherwise) */
  endpoint: string;
  /** Whether Janee integration is enabled */
  enabled: boolean;
  /** Cache TTL in ms for fetched credentials (default: 300000 = 5 min) */
  cacheTtlMs: number;
}

interface CachedCredential {
  value: string;
  expiresAt: number;
}

/**
 * Client for fetching API credentials from a Janee MCP server.
 *
 * Janee's HTTP transport exposes standard MCP tool calls over REST.
 * We call the `execute` tool to proxy requests, but for the LLM proxy
 * use case we need the raw credential to forward to upstream APIs.
 *
 * Flow:
 *   1. OpenSeed starts, connects to Janee if JANEE_ENDPOINT is set
 *   2. For each LLM request, proxy checks Janee for the API key
 *   3. Janee logs the access (creature name, timestamp, service)
 *   4. Key is cached briefly to avoid per-request latency
 */
export class JaneeClient {
  private config: JaneeConfig;
  private cache: Map<string, CachedCredential> = new Map();

  constructor(config?: Partial<JaneeConfig>) {
    const isDocker = process.env.OPENSEED_DOCKER === '1';
    this.config = {
      endpoint: config?.endpoint || process.env.JANEE_ENDPOINT ||
        (isDocker ? 'http://janee:9100' : 'http://localhost:9100'),
      enabled: config?.enabled ?? !!process.env.JANEE_ENDPOINT,
      cacheTtlMs: config?.cacheTtlMs ?? 300_000,
    };
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Fetch an API key for a given service, with per-creature audit logging.
   * Falls back to null if Janee is unavailable (caller should fall back to env vars).
   */
  async getCredential(
    service: string,
    creatureName: string,
  ): Promise<string | null> {
    if (!this.config.enabled) return null;

    // Check cache first
    const cacheKey = `${service}:${creatureName}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      // Call Janee's MCP HTTP endpoint to request credential access
      // This creates an audited session in Janee's logs
      const resp = await fetch(`${this.config.endpoint}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'request_access',
            arguments: {
              capability: service,
              reason: `OpenSeed LLM proxy for creature: ${creatureName}`,
            },
          },
        }),
      });

      if (!resp.ok) {
        console.warn(`[janee] credential fetch failed for ${service}: HTTP ${resp.status}`);
        return null;
      }

      const result = await resp.json() as any;
      const content = result?.result?.content;
      if (!content || !Array.isArray(content)) {
        console.warn(`[janee] unexpected response format for ${service}`);
        return null;
      }

      // Extract session token from response
      const textBlock = content.find((c: any) => c.type === 'text');
      if (!textBlock?.text) return null;

      try {
        const session = JSON.parse(textBlock.text);
        if (session.credential) {
          // Cache the credential
          this.cache.set(cacheKey, {
            value: session.credential,
            expiresAt: Date.now() + this.config.cacheTtlMs,
          });
          return session.credential;
        }
      } catch {
        // Response wasn't JSON, might be a status message
        console.warn(`[janee] could not parse credential response for ${service}`);
      }

      return null;
    } catch (err: any) {
      console.warn(`[janee] connection error: ${err.message}`);
      return null;
    }
  }

  /**
   * Check if Janee is reachable and healthy.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.config.enabled) return false;

    try {
      const resp = await fetch(`${this.config.endpoint}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /**
   * Revoke a creature's access to a service.
   * Called when a creature is stopped or its budget is exceeded.
   */
  async revokeAccess(service: string, creatureName: string): Promise<void> {
    if (!this.config.enabled) return;

    // Clear local cache
    this.cache.delete(`${service}:${creatureName}`);

    try {
      await fetch(`${this.config.endpoint}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'revoke_session',
            arguments: {
              service,
              reason: `OpenSeed revoked access for creature: ${creatureName}`,
            },
          },
        }),
      });
    } catch (err: any) {
      console.warn(`[janee] revoke error: ${err.message}`);
    }
  }

  /**
   * Clear the credential cache (useful on config reload).
   */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Singleton Janee client for the orchestrator.
 * Initialized lazily on first use.
 */
let _client: JaneeClient | null = null;

export function getJaneeClient(): JaneeClient {
  if (!_client) {
    _client = new JaneeClient();
    if (_client.enabled) {
      console.log(`[janee] secrets management enabled, endpoint: ${process.env.JANEE_ENDPOINT || 'auto-detected'}`);
    }
  }
  return _client;
}
