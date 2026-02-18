/**
 * Janee MCP secrets management tool for creatures.
 *
 * Connects to a Janee server via stdio (npx janee) or HTTP,
 * letting the creature manage secrets through MCP tool calls.
 */

import { execSync, spawn, ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

interface JaneeResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

let janeeProcess: ChildProcess | null = null;
let requestId = 0;
const pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
let outputBuffer = '';

function getJaneeConfig(): { mode: 'stdio' | 'http'; httpUrl?: string; command?: string } {
  // Check environment first
  if (process.env.JANEE_HTTP_URL) {
    return { mode: 'http', httpUrl: process.env.JANEE_HTTP_URL };
  }

  // Check well-known config paths
  const configPaths = [
    path.join(process.cwd(), 'janee.json'),
    path.join(process.env.HOME || '/root', '.janee', 'config.json'),
    path.join(process.env.OPENSEED_HOME || path.join(process.env.HOME || '/root', '.openseed'), 'janee.json'),
  ];

  for (const p of configPaths) {
    if (existsSync(p)) {
      try {
        const cfg = JSON.parse(readFileSync(p, 'utf-8'));
        if (cfg.httpUrl) return { mode: 'http', httpUrl: cfg.httpUrl };
        if (cfg.command) return { mode: 'stdio', command: cfg.command };
      } catch {}
    }
  }

  // Default: try stdio with npx
  return { mode: 'stdio', command: 'npx janee --stdio' };
}

function ensureStdioProcess(): ChildProcess {
  if (janeeProcess && !janeeProcess.killed) return janeeProcess;

  const config = getJaneeConfig();
  const cmd = config.command || 'npx janee --stdio';
  const [bin, ...args] = cmd.split(' ');

  janeeProcess = spawn(bin, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  janeeProcess.stdout!.on('data', (chunk: Buffer) => {
    outputBuffer += chunk.toString();
    // Parse JSON-RPC responses separated by newlines
    const lines = outputBuffer.split('\n');
    outputBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && pendingRequests.has(msg.id)) {
          const { resolve } = pendingRequests.get(msg.id)!;
          pendingRequests.delete(msg.id);
          resolve(msg);
        }
      } catch {}
    }
  });

  janeeProcess.on('exit', () => { janeeProcess = null; });

  // Send initialize
  const initId = ++requestId;
  janeeProcess.stdin!.write(JSON.stringify({
    jsonrpc: '2.0',
    id: initId,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'openseed-creature', version: '0.1.0' },
    },
  }) + '\n');

  return janeeProcess;
}

async function callMCPStdio(method: string, params: Record<string, unknown>): Promise<any> {
  const proc = ensureStdioProcess();
  const id = ++requestId;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Janee MCP call timed out after 30s'));
    }, 30_000);

    pendingRequests.set(id, {
      resolve: (v: any) => { clearTimeout(timer); resolve(v); },
      reject: (e: any) => { clearTimeout(timer); reject(e); },
    });

    proc.stdin!.write(JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }) + '\n');
  });
}

async function callMCPHttp(httpUrl: string, method: string, params: Record<string, unknown>): Promise<any> {
  const resp = await fetch(httpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
  });
  return resp.json();
}

async function callJanee(method: string, params: Record<string, unknown>): Promise<any> {
  const config = getJaneeConfig();
  if (config.mode === 'http' && config.httpUrl) {
    return callMCPHttp(config.httpUrl, method, params);
  }
  return callMCPStdio(method, params);
}

/**
 * Execute a Janee secrets management action.
 */
export async function executeJanee(action: string, args: Record<string, unknown>): Promise<JaneeResult> {
  try {
    switch (action) {
      case 'get': {
        const name = args.name as string;
        if (!name) return { ok: false, error: "Missing 'name' parameter" };
        const result = await callJanee('tools/call', {
          name: 'janee_get',
          arguments: { name },
        });
        if (result.error) return { ok: false, error: result.error.message };
        return { ok: true, data: result.result };
      }

      case 'set': {
        const name = args.name as string;
        const value = args.value as string;
        if (!name || value === undefined) return { ok: false, error: "Missing 'name' or 'value' parameter" };
        const result = await callJanee('tools/call', {
          name: 'janee_set',
          arguments: { name, value, ...(args.metadata ? { metadata: args.metadata } : {}) },
        });
        if (result.error) return { ok: false, error: result.error.message };
        return { ok: true, data: result.result };
      }

      case 'list': {
        const result = await callJanee('tools/call', {
          name: 'janee_list',
          arguments: args.pattern ? { pattern: args.pattern } : {},
        });
        if (result.error) return { ok: false, error: result.error.message };
        return { ok: true, data: result.result };
      }

      case 'delete': {
        const name = args.name as string;
        if (!name) return { ok: false, error: "Missing 'name' parameter" };
        const result = await callJanee('tools/call', {
          name: 'janee_delete',
          arguments: { name },
        });
        if (result.error) return { ok: false, error: result.error.message };
        return { ok: true, data: result.result };
      }

      case 'status': {
        const result = await callJanee('tools/call', {
          name: 'janee_status',
          arguments: {},
        });
        if (result.error) return { ok: false, error: result.error.message };
        return { ok: true, data: result.result };
      }

      default:
        return { ok: false, error: `Unknown janee action: ${action}. Valid actions: get, set, list, delete, status` };
    }
  } catch (err: any) {
    return { ok: false, error: `Janee unavailable: ${err.message}. Install with: npm install -g janee` };
  }
}

/**
 * Clean up the Janee stdio process on shutdown.
 */
export function closeJanee(): void {
  if (janeeProcess && !janeeProcess.killed) {
    janeeProcess.kill();
    janeeProcess = null;
  }
}
