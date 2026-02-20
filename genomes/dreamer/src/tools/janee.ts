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

let sessionId: string | null = null;

function getJaneeUrl(): string | null {
  const url = process.env.JANEE_URL;
  if (!url) return null;
  return url.replace(/\/+$/, '');
}

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
};

/** Parse SSE response from StreamableHTTP — extracts the JSON data line. */
function parseSSE(text: string): any {
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      return JSON.parse(line.slice(6));
    }
  }
  return JSON.parse(text);
}

async function ensureSession(baseUrl: string): Promise<string> {
  if (sessionId) return sessionId;

  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: process.env.CREATURE_NAME || 'creature', version: '1.0' },
      },
    }),
    signal: AbortSignal.timeout(5000),
  });

  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  return sessionId || '';
}

async function isJaneeReachable(baseUrl: string): Promise<boolean> {
  try {
    await ensureSession(baseUrl);
    return true;
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

  const sid = await ensureSession(baseUrl);

  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      ...MCP_HEADERS,
      ...(sid ? { 'Mcp-Session-Id': sid } : {}),
      'X-Creature-ID': process.env.CREATURE_NAME || process.env.HOSTNAME || 'unknown',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: method, arguments: params },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text();
    // Session may have expired — clear and retry once
    if (res.status === 400 || res.status === 404) {
      sessionId = null;
    }
    throw new Error(`Janee HTTP ${res.status}: ${text}`);
  }

  const text = await res.text();
  const json = parseSSE(text);
  if (json.error) {
    throw new Error(`Janee error: ${json.error.message || JSON.stringify(json.error)}`);
  }
  return json.result;
}

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

export async function janeeListServices(): Promise<string> {
  try {
    const result = await mcpCall('list_services');
    return JSON.stringify(result, null, 2);
  } catch (err: any) {
    return `Janee unavailable: ${err.message}\n\nFallback: check raw environment variables for API tokens.`;
  }
}

export async function janeeExecute(args: {
  capability: string;
  method: string;
  path: string;
  body?: string | Record<string, unknown>;
  reason?: string;
}): Promise<string> {
  try {
    const bodyStr = typeof args.body === 'string' ? args.body
      : args.body ? JSON.stringify(args.body)
      : undefined;
    const result = await mcpCall('execute', {
      capability: args.capability,
      method: args.method,
      path: args.path,
      ...(bodyStr ? { body: bodyStr } : {}),
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
  body?: string | Record<string, unknown>;
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
