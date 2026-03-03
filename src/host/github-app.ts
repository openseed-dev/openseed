import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  addCapabilityYAML,
  addServiceYAML,
  loadYAMLConfig,
  saveYAMLConfig,
} from '@true-and-useful/janee';

import { OPENSEED_HOME } from '../shared/paths.js';
import { reloadJaneeConfig } from './janee.js';

const GITHUB_APPS_DIR = path.join(OPENSEED_HOME, 'github-apps');

// In-memory state for pending manifest flows (state → context)
const pendingFlows = new Map<string, { name: string; owner: string; createdAt: number }>();
const FLOW_TTL_MS = 10 * 60 * 1000;

// ── GitHub API helper ──

async function githubApi(token: string, method: string, urlPath: string, body?: unknown): Promise<any> {
  const res = await fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'openseed',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const txt = await res.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { /* not json */ }

  if (!res.ok) {
    const msg = json?.message || txt || `${res.status} ${res.statusText}`;
    throw new Error(`GitHub API error: ${msg}`);
  }
  return json;
}

// ── JWT for authenticating as a GitHub App ──

function createAppJWT(appId: string, pemKey: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iat: now - 60,
    exp: now + 5 * 60,
    iss: appId,
  })).toString('base64url');
  const sigInput = `${header}.${payload}`;
  const sig = crypto.sign('sha256', Buffer.from(sigInput), pemKey).toString('base64url');
  return `${sigInput}.${sig}`;
}

// ── Manifest ──

function createManifest(name: string, callbackUrl: string): Record<string, unknown> {
  return {
    name,
    url: 'https://github.com/openseed-dev/openseed',
    redirect_url: callbackUrl,
    description: `GitHub App: ${name}`,
    public: false,
    default_permissions: {
      contents: 'write',
      pull_requests: 'write',
      issues: 'write',
    },
    default_events: [
      'pull_request',
      'pull_request_review',
      'issues',
      'issue_comment',
    ],
    hook_attributes: {
      url: 'https://example.com/github/webhook',
      active: false,
    },
  };
}

function manifestFormUrl(owner: string, state: string): string {
  const clean = owner?.replace(/^@/, '');
  if (!clean || clean === 'me') {
    return `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`;
  }
  return `https://github.com/organizations/${encodeURIComponent(clean)}/settings/apps/new?state=${encodeURIComponent(state)}`;
}

// ── Disk storage ──

export interface GitHubAppInfo {
  id: number;
  slug: string;
  name: string;
  owner?: { login: string };
  html_url?: string;
  created_at?: string;
}

async function ensureAppsDir(): Promise<void> {
  await fs.mkdir(GITHUB_APPS_DIR, { recursive: true });
}

export async function saveApp(slug: string, appData: Record<string, any>, pem: string): Promise<void> {
  await ensureAppsDir();
  const dir = path.join(GITHUB_APPS_DIR, slug);
  await fs.mkdir(dir, { recursive: true });

  const safe = { ...appData };
  delete safe.pem;
  delete safe.client_secret;
  delete safe.webhook_secret;
  await fs.writeFile(path.join(dir, 'app.json'), JSON.stringify(safe, null, 2) + '\n', 'utf-8');
  await fs.writeFile(path.join(dir, 'private-key.pem'), pem, { mode: 0o600 });
}

export async function loadApps(): Promise<GitHubAppInfo[]> {
  await ensureAppsDir();
  const apps: GitHubAppInfo[] = [];
  try {
    const entries = await fs.readdir(GITHUB_APPS_DIR);
    for (const slug of entries) {
      const appFile = path.join(GITHUB_APPS_DIR, slug, 'app.json');
      try {
        const data = JSON.parse(await fs.readFile(appFile, 'utf-8'));
        apps.push({ id: data.id, slug: data.slug || slug, name: data.name, owner: data.owner, html_url: data.html_url, created_at: data.created_at });
      } catch { continue; }
    }
  } catch { /* dir doesn't exist yet */ }
  return apps;
}

export async function loadApp(slug: string): Promise<{ app: Record<string, any>; pem: string }> {
  const dir = path.join(GITHUB_APPS_DIR, slug);
  const app = JSON.parse(await fs.readFile(path.join(dir, 'app.json'), 'utf-8'));
  const pem = await fs.readFile(path.join(dir, 'private-key.pem'), 'utf-8');
  return { app, pem };
}

async function removeAppFiles(slug: string): Promise<void> {
  const dir = path.join(GITHUB_APPS_DIR, slug);
  await fs.rm(dir, { recursive: true, force: true });
}

// ── Flow management ──

function cleanExpiredFlows(): void {
  const now = Date.now();
  for (const [state, flow] of pendingFlows) {
    if (now - flow.createdAt > FLOW_TTL_MS) pendingFlows.delete(state);
  }
}

export function startFlow(name: string, owner: string): string {
  cleanExpiredFlows();
  const state = crypto.randomBytes(18).toString('base64url');
  pendingFlows.set(state, { name, owner, createdAt: Date.now() });
  return state;
}

export function consumeFlow(state: string): { name: string; owner: string } | null {
  cleanExpiredFlows();
  const flow = pendingFlows.get(state);
  if (!flow) return null;
  pendingFlows.delete(state);
  return flow;
}

// ── Route handlers ──

export function handleRedirect(state: string, orchestratorPort: number): string {
  const flow = consumeFlow(state);
  if (!flow) return '<h1>Invalid or expired state</h1><p>Please start the flow again from the dashboard.</p>';

  const callbackUrl = `http://127.0.0.1:${orchestratorPort}/api/github-app/callback`;
  const manifest = createManifest(flow.name, callbackUrl);
  const actionUrl = manifestFormUrl(flow.owner, state);

  return `<!doctype html><meta charset="utf-8">
<title>Create GitHub App</title>
<p>Redirecting to GitHub…</p>
<form id="f" action="${actionUrl}" method="post">
  <input type="hidden" name="manifest" id="manifest">
</form>
<script>
  document.getElementById("manifest").value = ${JSON.stringify(JSON.stringify(manifest))};
  document.getElementById("f").submit();
</script>`;
}

export async function handleCallback(code: string, _state: string): Promise<{ html: string; error?: string }> {
  // State was already consumed by handleRedirect to prevent duplicate submissions.
  // The one-time `code` from GitHub is the real credential (single-use, enforced by GitHub).
  try {
    // No auth token needed — the one-time manifest code is itself the credential.
    const res = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'openseed',
      },
    });

    const txt = await res.text();
    let app: any;
    try { app = JSON.parse(txt); } catch {
      return { html: `<h1>Error</h1><p>Invalid response from GitHub.</p>`, error: 'invalid response' };
    }

    if (!res.ok) {
      const msg = app?.message || `${res.status} ${res.statusText}`;
      return { html: `<h1>Error</h1><p>${escapeHtml(msg)}</p>`, error: msg };
    }

    const pem = app?.pem;
    if (!pem) {
      return { html: '<h1>Error</h1><p>No private key returned from GitHub.</p>', error: 'no pem' };
    }

    await saveApp(app.slug, app, pem);
    console.log(`[github-app] created: ${app.slug} (id: ${app.id})`);

    const installUrl = `https://github.com/apps/${app.slug}/installations/new`;
    return {
      html: `<!doctype html><meta charset="utf-8">
<title>GitHub App Created</title>
<style>body{font-family:system-ui;max-width:480px;margin:60px auto;color:#1a1a1a}
a{color:#0066cc}code{background:#f0f0f0;padding:2px 6px;border-radius:3px;font-size:14px}</style>
<h1>GitHub App created</h1>
<p>App <strong>${escapeHtml(app.slug)}</strong> (id: ${escapeHtml(String(app.id))}) has been saved.</p>
<p>Next step: <a href="${installUrl}" target="_blank">Install it on your repos</a>, then go back to the dashboard to activate it.</p>
<p style="margin-top:40px;color:#888;font-size:13px">You can close this tab.</p>`,
    };
  } catch (err: any) {
    const msg = err.message || 'Unknown error';
    return { html: `<h1>Error</h1><p>${escapeHtml(msg)}</p>`, error: msg };
  }
}

export async function fetchInstallations(slug: string): Promise<any[]> {
  const { app, pem } = await loadApp(slug);
  const jwt = createAppJWT(String(app.id), pem);
  const installations = await githubApi(jwt, 'GET', '/app/installations');
  return installations || [];
}

export async function activateInstallation(slug: string, installationId: string): Promise<{ serviceName: string }> {
  const { app, pem } = await loadApp(slug);

  const serviceName = `gh-${slug}`;
  const safeServiceName = serviceName.replace(/[^a-z0-9-]/g, '-');

  addServiceYAML(safeServiceName, 'https://api.github.com', {
    type: 'github-app',
    appId: String(app.id),
    privateKey: pem,
    installationId,
  });

  addCapabilityYAML(`${safeServiceName}-proxy`, {
    service: safeServiceName,
    ttl: '1h',
    mode: 'proxy',
  });

  addCapabilityYAML(`${safeServiceName}-exec`, {
    service: safeServiceName,
    ttl: '1h',
    mode: 'exec',
    allowCommands: ['git', 'gh'],
    env: {
      GH_TOKEN: '{{credential}}',
      GITHUB_TOKEN: '{{credential}}',
    },
  });

  reloadJaneeConfig();
  console.log(`[github-app] activated: ${safeServiceName} (installation: ${installationId})`);
  return { serviceName: safeServiceName };
}

export async function deleteApp(slug: string): Promise<void> {
  try {
    const { app, pem } = await loadApp(slug);
    const jwt = createAppJWT(String(app.id), pem);
    await githubApi(jwt, 'DELETE', '/app');
    console.log(`[github-app] deleted from GitHub: ${slug}`);
  } catch (err: any) {
    console.warn(`[github-app] could not delete from GitHub: ${err.message}`);
  }

  // Clean up Janee service + capabilities created during activation
  const safeServiceName = `gh-${slug}`.replace(/[^a-z0-9-]/g, '-');
  try {
    const config = loadYAMLConfig();
    let changed = false;
    for (const capName of [`${safeServiceName}-proxy`, `${safeServiceName}-exec`]) {
      if (config.capabilities[capName]) {
        delete config.capabilities[capName];
        changed = true;
      }
    }
    if (config.services[safeServiceName]) {
      delete config.services[safeServiceName];
      changed = true;
    }
    if (changed) {
      saveYAMLConfig(config);
      reloadJaneeConfig();
      console.log(`[github-app] removed Janee service/capabilities: ${safeServiceName}`);
    }
  } catch (err: any) {
    console.warn(`[github-app] could not clean up Janee config: ${err.message}`);
  }

  await removeAppFiles(slug);
  console.log(`[github-app] removed local files: ${slug}`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
