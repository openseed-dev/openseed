/**
 * Janee integration for creature genomes.
 *
 * Janee is a shared service on the Docker network that proxies API requests
 * on behalf of creatures. The creature never sees raw API keys — it calls
 * Janee with a capability name, method, and path, and Janee injects the
 * real credentials, makes the request, and returns the response.
 *
 * The supervisor injects JANEE_URL into the creature's environment.
 * Janee is REQUIRED for any authenticated API access or git operations.
 *
 * @see https://github.com/rsdouglas/janee
 */

let sessionId: string | null = null;

function getJaneeUrl(): string | null {
  const url = process.env.JANEE_URL || 'http://host.docker.internal:3100';
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
        clientInfo: { name: `creature:${process.env.CREATURE_NAME || 'unknown'}`, version: '1.0' },
      },
    }),
    signal: AbortSignal.timeout(5000),
  });

  const sid = res.headers.get('mcp-session-id');
  if (sid) {
    sessionId = sid;
  } else {
    const text = await res.text();
    const json = parseSSE(text);
    if (json?.error?.message?.includes('already initialized') && json?.error?.data?.sessionId) {
      sessionId = json.error.data.sessionId;
    }
  }
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

async function mcpCall(method: string, params: Record<string, unknown> = {}, _retry = false): Promise<unknown> {
  const baseUrl = getJaneeUrl();
  if (!baseUrl) {
    throw new Error(
      'Janee is not configured (JANEE_URL not set). ' +
      'Cannot authenticate. The orchestrator may have started without Janee.',
    );
  }

  const sid = await ensureSession(baseUrl);

  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      ...MCP_HEADERS,
      ...(sid ? { 'Mcp-Session-Id': sid } : {}),
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
    if (!_retry && (res.status === 400 || res.status === 404)) {
      sessionId = null;
      return mcpCall(method, params, true);
    }
    throw new Error(`Janee HTTP ${res.status}: ${text}`);
  }

  const text = await res.text();
  const json = parseSSE(text);
  if (json.error) {
    if (!_retry && json.error.message?.includes('session')) {
      sessionId = null;
      return mcpCall(method, params, true);
    }
    throw new Error(`Janee error: ${json.error.message || JSON.stringify(json.error)}`);
  }
  return json.result;
}

export async function janeeStatus(): Promise<string> {
  const url = getJaneeUrl();
  if (!url) {
    return JSON.stringify({
      available: false,
      reason: 'JANEE_URL not set — cannot authenticate.',
      hint: 'The orchestrator may have started without Janee. Do not attempt API calls or git operations until Janee is available.',
    }, null, 2);
  }

  const reachable = await isJaneeReachable(url);
  return JSON.stringify({
    available: reachable,
    url,
    ...(reachable ? {} : {
      reason: 'Janee service not reachable',
      hint: 'Janee may be starting up or temporarily down. Do not attempt API calls or git operations until Janee is available. Sleep and retry.',
    }),
  }, null, 2);
}

export async function janeeListServices(): Promise<string> {
  try {
    const result = await mcpCall('list_services');
    return JSON.stringify(result, null, 2);
  } catch (err: any) {
    return `Janee unavailable: ${err.message}. Cannot list services — no authentication available without Janee.`;
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
    return `Janee unavailable: ${err.message}. Cannot make authenticated API calls without Janee.`;
  }
}

export async function janeeExec(args: {
  capability: string;
  command: string[];
  cwd?: string;
  reason?: string;
}): Promise<string> {
  try {
    const result = await mcpCall('janee_exec', {
      capability: args.capability,
      command: args.command,
      ...(args.cwd ? { cwd: args.cwd } : {}),
      ...(args.reason ? { reason: args.reason } : {}),
    });
    return JSON.stringify(result, null, 2);
  } catch (err: any) {
    return `Janee exec failed: ${err.message}`;
  }
}

/**
 * Main entry point — dispatches Janee tool calls.
 */
export async function janee(args: {
  action: 'status' | 'list_services' | 'execute' | 'exec';
  capability?: string;
  method?: string;
  path?: string;
  body?: string | Record<string, unknown>;
  command?: string[];
  cwd?: string;
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

    case 'exec':
      if (!args.capability || !args.command?.length) {
        return 'Error: exec requires capability and command (array of strings)';
      }
      return janeeExec({
        capability: args.capability,
        command: args.command,
        cwd: args.cwd,
        reason: args.reason,
      });

    default:
      return `Error: unknown action "${args.action}". Use: status, list_services, execute, exec`;
  }
}
