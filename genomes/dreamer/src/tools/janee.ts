/**
 * Janee integration for dreamer genome.
 *
 * Janee is a shared service on the Docker network that proxies API requests
 * on behalf of creatures. The creature never sees raw API keys — it calls
 * Janee with a capability name, method, and path, and Janee injects the
 * real credentials, makes the request, and returns the response.
 *
 * The supervisor injects JANEE_URL into the creature's environment.
 *
 * GRACEFUL DEGRADATION: If Janee is not running or JANEE_URL is not set,
 * the tool reports unavailability instead of crashing. The creature can
 * still function using raw env vars (e.g. GITHUB_TOKEN) as it did before
 * Janee existed.
 *
 * @see https://github.com/rsdouglas/janee
 */

function getJaneeUrl(): string | null {
  const url = process.env.JANEE_URL;
  if (!url) return null;
  return url.replace(/\/+$/, '');
}

async function isJaneeReachable(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'ping',
        params: {},
      }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok || res.status === 400; // 400 = valid endpoint, bad request
  } catch {
    return false;
  }
}

async function mcpCall(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const baseUrl = getJaneeUrl();
  if (!baseUrl) {
    throw new Error(
      'Janee is not configured (JANEE_URL not set). ' +
      'You can still access APIs using raw environment variables like GITHUB_TOKEN.',
    );
  }

  const creatureId = process.env.CREATURE_NAME || process.env.HOSTNAME || 'unknown';

  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Creature-ID': creatureId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: method, arguments: params },
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Janee HTTP ${res.status}: ${text}`);
  }

  const json = await res.json() as any;
  if (json.error) {
    throw new Error(`Janee error: ${json.error.message || JSON.stringify(json.error)}`);
  }
  return json.result;
}

/**
 * Check if Janee is available. Returns status info.
 */
export async function janeeStatus(): Promise<string> {
  const url = getJaneeUrl();
  if (!url) {
    return JSON.stringify({
      available: false,
      reason: 'JANEE_URL not set',
      hint: 'Janee is optional. Use raw env vars (GITHUB_TOKEN, etc.) for API access.',
    }, null, 2);
  }

  const reachable = await isJaneeReachable(url);
  return JSON.stringify({
    available: reachable,
    url,
    ...(reachable ? {} : {
      reason: 'Janee service not reachable',
      hint: 'Janee may be starting up or not deployed. Use raw env vars as fallback.',
    }),
  }, null, 2);
}

/**
 * List available services and the creature's capabilities for each.
 */
export async function janeeListServices(): Promise<string> {
  try {
    const result = await mcpCall('list_services');
    return JSON.stringify(result, null, 2);
  } catch (err: any) {
    return `Janee unavailable: ${err.message}\n\nFallback: check raw environment variables for API tokens.`;
  }
}

/**
 * Execute an API request through Janee. The creature specifies what it wants
 * to do; Janee injects the real credentials and proxies the request.
 *
 * @param capability - The service capability to use (e.g. "github", "stripe")
 * @param method - HTTP method (GET, POST, PUT, DELETE, etc.)
 * @param path - API path (e.g. "/user", "/v1/balance")
 * @param body - Optional request body (for POST/PUT)
 * @param reason - Why the creature needs this request (for audit trail)
 */
export async function janeeExecute(args: {
  capability: string;
  method: string;
  path: string;
  body?: Record<string, unknown>;
  reason?: string;
}): Promise<string> {
  try {
    const result = await mcpCall('execute', {
      capability: args.capability,
      method: args.method,
      path: args.path,
      ...(args.body ? { body: JSON.stringify(args.body) } : {}),
      ...(args.reason ? { reason: args.reason } : {}),
    });
    return JSON.stringify(result, null, 2);
  } catch (err: any) {
    return `Janee unavailable: ${err.message}\n\nFallback: use raw API calls with environment variable tokens.`;
  }
}

/**
 * Main entry point — dispatches Janee tool calls.
 */
export async function janee(args: {
  action: 'status' | 'list_services' | 'execute';
  capability?: string;
  method?: string;
  path?: string;
  body?: Record<string, unknown>;
  reason?: string;
}): Promise<string> {
  switch (args.action) {
    case 'status':
      return janeeStatus();

    case 'list_services':
      return janeeListServices();

    case 'execute':
      if (!args.capability || !args.method || !args.path) {
        return 'Error: execute requires capability, method, and path';
      }
      return janeeExecute({
        capability: args.capability,
        method: args.method,
        path: args.path,
        body: args.body,
        reason: args.reason,
      });

    default:
      return `Error: unknown action "${args.action}". Use: status, list_services, execute`;
  }
}
