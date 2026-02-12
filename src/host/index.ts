import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { Event } from '../shared/types.js';
import { EventStore } from './events.js';
import {
  CreatureSupervisor,
  SupervisorConfig,
} from './supervisor.js';

const ITSALIVE_HOME = path.join(os.homedir(), '.itsalive');
const CREATURES_DIR = path.join(ITSALIVE_HOME, 'creatures');

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

export class Orchestrator {
  private port: number;
  private supervisors: Map<string, CreatureSupervisor> = new Map();
  private stores: Map<string, EventStore> = new Map();
  private globalListeners: Set<(name: string, event: Event) => void> = new Set();

  constructor(port: number) {
    this.port = port;
  }

  async start() {
    console.log('[orchestrator] starting...');
    await this.writeRunFile();
    this.setupCleanup();
    this.createServer();
    await this.autoReconnect();
    console.log(`[orchestrator] ready at http://localhost:${this.port}`);
  }

  // --- Lifecycle ---

  private async writeRunFile() {
    await fs.mkdir(ITSALIVE_HOME, { recursive: true });
    await fs.writeFile(
      path.join(ITSALIVE_HOME, 'orchestrator.json'),
      JSON.stringify({ port: this.port, pid: process.pid, started_at: new Date().toISOString() }, null, 2) + '\n',
      'utf-8',
    );
  }

  private setupCleanup() {
    const cleanup = async () => {
      try { await fs.unlink(path.join(ITSALIVE_HOME, 'orchestrator.json')); } catch {}
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  // --- Discovery ---

  private async discoverCreatures(): Promise<Array<{ name: string; dir: string }>> {
    const creatures: Array<{ name: string; dir: string }> = [];
    try {
      const entries = await fs.readdir(CREATURES_DIR);
      for (const name of entries) {
        const dir = path.join(CREATURES_DIR, name);
        try {
          await fs.access(path.join(dir, 'BIRTH.json'));
          creatures.push({ name, dir });
        } catch { continue; }
      }
    } catch { /* no creatures dir yet */ }
    return creatures;
  }

  private async autoReconnect() {
    const creatures = await this.discoverCreatures();
    for (const { name, dir } of creatures) {
      const port = this.getContainerPort(name);
      if (port) {
        console.log(`[orchestrator] found running container for ${name} on port ${port}`);
        await this.startCreatureInternal(name, dir, port, { sandboxed: true, autoIterate: true });
      }
    }
  }

  private getContainerPort(name: string): number | null {
    try {
      const out = execSync(`docker port creature-${name} 7778`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      const port = parseInt(out.split(':').pop()!);
      return isNaN(port) ? null : port;
    } catch {
      return null;
    }
  }

  // --- Port allocation ---

  private async allocatePort(): Promise<number> {
    const used = new Set<number>([this.port]);
    for (const sup of this.supervisors.values()) used.add(sup.port);

    let port = 7771;
    while (port < 65534) {
      if (!used.has(port) && await this.isPortAvailable(port)) return port;
      port++;
    }
    throw new Error('no available ports');
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => { server.close(() => resolve(true)); });
      server.listen(port, '127.0.0.1');
    });
  }

  private isDockerAvailable(): boolean {
    try { execSync('docker info', { stdio: 'ignore' }); return true; } catch { return false; }
  }

  private hasDockerImage(name: string): boolean {
    try {
      return execSync(`docker images -q creature-${name}`, { encoding: 'utf-8' }).trim().length > 0;
    } catch { return false; }
  }

  // --- Creature management ---

  async startCreature(name: string, opts?: { bare?: boolean; manual?: boolean }): Promise<void> {
    if (this.supervisors.has(name)) throw new Error(`creature "${name}" is already running`);

    const dir = path.join(CREATURES_DIR, name);
    try { await fs.access(path.join(dir, 'BIRTH.json')); }
    catch { throw new Error(`creature "${name}" not found`); }

    const sandboxed = !(opts?.bare) && this.isDockerAvailable() && this.hasDockerImage(name);
    const autoIterate = !(opts?.manual);
    const port = await this.allocatePort();

    console.log(`[orchestrator] starting ${name} (${sandboxed ? 'sandboxed' : 'bare'}) on port ${port}`);
    await this.startCreatureInternal(name, dir, port, { sandboxed, autoIterate });
  }

  private async startCreatureInternal(
    name: string, dir: string, port: number,
    opts: { sandboxed: boolean; autoIterate: boolean },
  ) {
    const store = new EventStore(dir);
    await store.init();
    this.stores.set(name, store);

    const config: SupervisorConfig = {
      name, dir, port,
      orchestratorPort: this.port,
      autoIterate: opts.autoIterate,
      sandboxed: opts.sandboxed,
    };

    const supervisor = new CreatureSupervisor(config, async (n, event) => {
      await this.emitEvent(n, event);
    });

    this.supervisors.set(name, supervisor);
    await supervisor.start();
  }

  async stopCreature(name: string): Promise<void> {
    const supervisor = this.supervisors.get(name);
    if (!supervisor) throw new Error(`creature "${name}" is not running`);
    await supervisor.stop();
    this.supervisors.delete(name);
    this.stores.delete(name);
  }

  async restartCreature(name: string): Promise<void> {
    const supervisor = this.supervisors.get(name);
    if (!supervisor) throw new Error(`creature "${name}" is not running`);
    await supervisor.restart();
  }

  // --- Events ---

  private async emitEvent(name: string, event: Event) {
    const store = this.stores.get(name);
    if (store) await store.append(event);

    const supervisor = this.supervisors.get(name);
    if (supervisor) supervisor.updateFromEvent(event);

    this.globalListeners.forEach(fn => fn(name, event));

    console.log(`[${name}] ${event.type}`);
  }

  async handleCreatureEvent(name: string, event: Event): Promise<void> {
    // Ensure we have a store even if supervisor isn't tracked (reconnecting containers)
    if (!this.stores.has(name)) {
      const dir = path.join(CREATURES_DIR, name);
      try {
        await fs.access(path.join(dir, 'BIRTH.json'));
        const store = new EventStore(dir);
        await store.init();
        this.stores.set(name, store);
      } catch { /* unknown creature, still emit */ }
    }
    await this.emitEvent(name, event);
  }

  async sendMessage(name: string, text: string): Promise<void> {
    const supervisor = this.supervisors.get(name);
    if (!supervisor) throw new Error(`creature "${name}" is not running`);

    const res = await fetch(`http://127.0.0.1:${supervisor.port}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) throw new Error(`creature rejected message: ${await res.text()}`);
    console.log(`[${name}] creator message injected: ${text.slice(0, 80)}`);
  }

  async listCreatures(): Promise<Array<{ name: string; status: string; sha: string | null; port: number | null }>> {
    const all = await this.discoverCreatures();
    return all.map(({ name }) => {
      const sup = this.supervisors.get(name);
      if (sup) {
        const info = sup.getInfo();
        return { name, status: info.status, sha: info.sha, port: info.port };
      }
      return { name, status: 'stopped', sha: null, port: null };
    });
  }

  // --- HTTP Server ---

  private createServer() {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${this.port}`);
      const p = url.pathname;

      if (p === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(this.renderDashboard());
        return;
      }

      if (p === '/api/creatures' && req.method === 'GET') {
        const creatures = await this.listCreatures();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(creatures));
        return;
      }

      if (p === '/api/events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        const listener = (name: string, event: Event) => {
          res.write(`data: ${JSON.stringify({ creature: name, ...event })}\n\n`);
        };
        this.globalListeners.add(listener);
        req.on('close', () => this.globalListeners.delete(listener));
        return;
      }

      // Creature-specific routes: /api/creatures/:name/:action
      const match = p.match(/^\/api\/creatures\/([^/]+)\/(.+)$/);
      if (match) {
        const [, name, action] = match;

        if (action === 'event' && req.method === 'POST') {
          const body = await readBody(req);
          try {
            const event = JSON.parse(body) as Event;
            await this.handleCreatureEvent(name, event);
            res.writeHead(200); res.end('ok');
          } catch { res.writeHead(400); res.end('invalid event'); }
          return;
        }

        if (action === 'events' && req.method === 'GET') {
          try {
            const store = this.stores.get(name) || new EventStore(path.join(CREATURES_DIR, name));
            if (!this.stores.has(name)) await store.init();
            const events = await store.readRecent(200);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(events));
          } catch {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('[]');
          }
          return;
        }

        if (action === 'start' && req.method === 'POST') {
          try {
            const body = await readBody(req);
            const opts = body ? JSON.parse(body) : {};
            await this.startCreature(name, opts);
            res.writeHead(200); res.end('ok');
          } catch (err: any) { res.writeHead(400); res.end(err.message); }
          return;
        }

        if (action === 'stop' && req.method === 'POST') {
          try {
            await this.stopCreature(name);
            res.writeHead(200); res.end('ok');
          } catch (err: any) { res.writeHead(400); res.end(err.message); }
          return;
        }

        if (action === 'restart' && req.method === 'POST') {
          try {
            await this.restartCreature(name);
            res.writeHead(200); res.end('ok');
          } catch (err: any) { res.writeHead(400); res.end(err.message); }
          return;
        }

        if (action === 'message' && req.method === 'POST') {
          try {
            const body = await readBody(req);
            const { text } = JSON.parse(body);
            await this.sendMessage(name, text);
            res.writeHead(200); res.end('ok');
          } catch (err: any) { res.writeHead(400); res.end(err.message); }
          return;
        }
      }

      // Legacy: creatures without CREATURE_NAME env var POST here
      if (p === '/event' && req.method === 'POST') {
        const body = await readBody(req);
        try {
          const event = JSON.parse(body) as Event;
          const name = req.headers['x-creature-name'] as string;
          if (name) {
            await this.handleCreatureEvent(name, event);
          } else {
            console.warn('[orchestrator] /event without creature name, dropping');
          }
          res.writeHead(200); res.end('ok');
        } catch { res.writeHead(400); res.end('invalid event'); }
        return;
      }

      res.writeHead(404); res.end('not found');
    });

    server.listen(this.port, () => {
      console.log(`[orchestrator] listening on http://localhost:${this.port}`);
    });
  }

  // --- Dashboard ---

  private renderDashboard(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>itsalive</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      background: #0a0a0a; color: #ccc; font-size: 13px;
      display: flex;
    }

    .sidebar {
      position: sticky; top: 0; height: 100vh;
      width: 220px; border-right: 1px solid #222;
      display: flex; flex-direction: column; flex-shrink: 0;
      overflow-y: auto;
    }
    .sidebar-header {
      padding: 16px; color: #0f0; font-size: 16px; font-weight: bold;
      border-bottom: 1px solid #222;
    }
    .creature-list { padding: 8px; flex: 1; }
    .creature-item {
      padding: 8px 12px; border-radius: 4px; cursor: pointer;
      display: flex; align-items: center; gap: 8px; margin-bottom: 2px;
    }
    .creature-item:hover { background: #1a1a1a; }
    .creature-item.selected { background: #1a1a2a; border-left: 2px solid #58f; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .dot.stopped { background: #555; }
    .dot.starting { background: #fa0; }
    .dot.running { background: #0f0; }
    .dot.sleeping { background: #f80; }
    .cname { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .btn {
      background: #222; border: 1px solid #333; color: #aaa;
      padding: 2px 6px; border-radius: 3px; cursor: pointer;
      font-family: inherit; font-size: 11px;
    }
    .btn:hover { background: #333; color: #fff; }

    .main {
      flex: 1; min-width: 0; padding: 16px;
    }
    .main-header {
      padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid #222;
      display: flex; align-items: center; gap: 16px;
    }
    .main-header h2 { color: #eee; font-size: 14px; }
    .main-header .info { color: #555; font-size: 12px; }
    .main-header .sha { color: #58f; }
    .events { display: flex; flex-direction: column; gap: 2px; }

    .event { padding: 6px 12px; border-radius: 4px; border-left: 3px solid #333; background: #111; }
    .event .time { color: #555; font-size: 11px; }
    .event .clabel { color: #58f; font-size: 11px; margin-left: 4px; font-weight: bold; }
    .event .type { font-weight: bold; margin-left: 8px; }

    .event.host-boot { border-left-color: #666; }
    .event.host-spawn { border-left-color: #58f; }
    .event.host-promote { border-left-color: #0f0; }
    .event.host-rollback { border-left-color: #f33; background: #1a0808; }
    .event.creature-boot { border-left-color: #58f; }
    .event.creature-thought { border-left-color: #888; }
    .event.creature-sleep { border-left-color: #fa0; }
    .event.creature-tool-call { border-left-color: #0af; }
    .event.creature-tool-call.browser { border-left-color: #a6e; }
    .event.creature-tool-call.fail { border-left-color: #f55; }
    .event.creature-dream { border-left-color: #a6e; background: #0f0a15; }
    .event.creature-dream.deep { border-left-color: #c8f; background: #120a1a; }

    .event .type.host { color: #666; }
    .event .type.promote { color: #0f0; }
    .event .type.rollback { color: #f33; }
    .event .type.sleep { color: #fa0; }
    .event .type.tool { color: #0af; }
    .event .type.tool.browser { color: #a6e; }
    .event .type.tool.fail { color: #f55; }
    .event .type.thought { color: #aaa; }
    .event .type.dream { color: #a6e; font-style: italic; }
    .event .type.dream.deep { color: #c8f; font-weight: bold; }
    .event .type.boot { color: #58f; }

    .intent-text { color: #eee; margin-left: 4px; white-space: pre-wrap; }
    .thought-summary { cursor: pointer; }
    .thought-summary:hover { text-decoration: underline; }
    .thought-body { display: none; margin-top: 6px; padding: 8px; background: #0d0d0d; border-radius: 4px; white-space: pre-wrap; word-break: break-word; color: #aaa; font-size: 12px; }
    .thought-body.open { display: block; }
    .tool-cmd { color: #fff; background: #1a1a2a; padding: 2px 6px; border-radius: 3px; margin-left: 6px; }
    .tool-status { margin-left: 6px; font-size: 11px; }
    .tool-status.ok { color: #0f0; }
    .tool-status.err { color: #f55; }
    .tool-output { display: block; color: #888; margin-top: 4px; padding: 6px 8px; background: #0d0d0d; border-radius: 3px; white-space: pre-wrap; word-break: break-all; font-size: 12px; }
    .tool-ms { color: #555; font-size: 11px; margin-left: 6px; }
    .tool-detail { white-space: pre-wrap; word-break: break-all; font-size: 12px; color: #888; padding: 8px; background: #0d0d0d; border-radius: 4px; margin-top: 6px; }
    .tool-detail-cmd { margin-bottom: 6px; }
    .tool-detail-out { border-top: 1px solid #222; padding-top: 6px; }
    .sha { color: #58f; }
    .detail { color: #888; margin-left: 4px; }

    .message-bar {
      position: sticky; bottom: 0; background: #0a0a0a;
      padding: 12px 0; margin-top: 12px; border-top: 1px solid #222;
      display: none; gap: 8px;
    }
    .message-bar.visible { display: flex; }
    .message-bar textarea {
      flex: 1; background: #111; border: 1px solid #333;
      color: #eee; padding: 8px 12px; border-radius: 4px;
      font-family: inherit; font-size: 13px;
      resize: vertical; min-height: 38px; max-height: 200px;
    }
    .message-bar textarea:focus { outline: none; border-color: #58f; }
    .message-bar button {
      background: #1a1a2a; border: 1px solid #58f; color: #58f;
      padding: 8px 16px; border-radius: 4px; cursor: pointer;
      font-family: inherit; font-size: 13px;
    }
    .message-bar button:hover { background: #2a2a4a; }
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="sidebar-header">itsalive</div>
    <div class="creature-list" id="creatures"></div>
  </div>
  <div class="main">
    <div class="main-header" id="header">
      <h2>all creatures</h2>
    </div>
    <div class="events" id="events"></div>
    <div class="message-bar" id="msgbar">
      <textarea id="msg" placeholder="Message to creature... (Cmd+Enter to send)" rows="2" onkeydown="if(event.key==='Enter'&&event.metaKey){event.preventDefault();sendMsg()}"></textarea>
      <button onclick="sendMsg()">Send</button>
    </div>
  </div>

  <script>
    let selected = null;
    let creatures = {};
    const eventsEl = document.getElementById('events');
    const headerEl = document.getElementById('header');
    const msgBar = document.getElementById('msgbar');

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function ts(t) { return t ? t.slice(11, 19) : ''; }
    function toggle(id) { document.getElementById(id)?.classList.toggle('open'); }
    function summarize(text, max) {
      if (!text) return '...';
      const line = text.split('\\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))[0] || text.trim();
      return line.length > max ? line.slice(0, max) + '...' : line;
    }

    function uid() { return 'u' + Date.now() + Math.random().toString(36).slice(2,6); }

    function renderEvent(ev, showCreature) {
      const t = ev.type;
      let cls = t.replace(/\\./g, '-');
      let body = '';
      const cl = showCreature && ev.creature ? '<span class="clabel">' + esc(ev.creature) + '</span>' : '';

      if (t === 'creature.sleep') {
        const secs = ev.seconds || 30;
        const acts = ev.actions || 0;
        const id = uid();
        body = cl + '<span class="type sleep">sleep</span>'
          + '<span class="tool-ms">' + secs + 's / ' + acts + ' actions</span>'
          + '<span class="intent-text thought-summary" onclick="toggle(\\''+id+'\\')"> \\u2014 ' + esc(summarize(ev.text, 120)) + '</span>'
          + '<div class="thought-body" id="'+id+'">' + esc(ev.text || '') + '</div>';
      } else if (t === 'creature.tool_call') {
        const tn = ev.tool || 'bash';
        const br = tn === 'browser';
        cls += ev.ok ? '' : ' fail';
        cls += br ? ' browser' : '';
        const tc = 'type tool' + (br ? ' browser' : '') + (ev.ok ? '' : ' fail');
        const oid = uid();
        const cmdPreview = (ev.input || '').length > 80 ? (ev.input || '').slice(0,80) + '...' : (ev.input || '');
        body = cl + '<span class="' + tc + ' thought-summary" onclick="toggle(\\''+oid+'\\')">\\u25b6 ' + esc(tn) + '</span>'
          + '<code class="tool-cmd thought-summary" onclick="toggle(\\''+oid+'\\')"> ' + esc(cmdPreview) + '</code>'
          + (ev.ok ? '<span class="tool-status ok">ok</span>' : '<span class="tool-status err">fail</span>')
          + '<span class="tool-ms">' + (ev.ms||0) + 'ms</span>'
          + '<div class="tool-detail thought-body" id="'+oid+'">'
          + '<div class="tool-detail-cmd"><strong>input:</strong> ' + esc(ev.input || '') + '</div>'
          + (ev.output ? '<div class="tool-detail-out"><strong>output:</strong>\\n' + esc(ev.output) + '</div>' : '')
          + '</div>';
      } else if (t === 'creature.thought') {
        body = cl + '<span class="type thought">thought</span>'
          + '<span class="intent-text"> ' + esc(ev.text || '') + '</span>';
      } else if (t === 'creature.dream') {
        const deep = ev.deep ? ' deep' : '';
        cls += deep;
        const oid = uid();
        const label = ev.deep ? 'deep sleep' : 'dream';
        body = cl + '<span class="type dream' + deep + '">' + label + '</span>'
          + '<span class="tool-ms">' + (ev.observations || 0) + ' observations</span>'
          + '<span class="intent-text thought-summary" onclick="toggle(\\''+oid+'\\')"> \\u2014 ' + esc(summarize(ev.priority || '', 120)) + '</span>'
          + '<div class="thought-body" id="'+oid+'">'
          + '<strong>Priority:</strong> ' + esc(ev.priority || '') + '\\n\\n'
          + '<strong>Reflection:</strong>\\n' + esc(ev.reflection || '')
          + '</div>';
      } else if (t === 'host.promote') {
        body = cl + '<span class="type promote">promoted</span><span class="detail"><span class="sha">' + (ev.sha||'').slice(0,7) + '</span></span>';
      } else if (t === 'host.rollback') {
        body = cl + '<span class="type rollback">rollback</span><span class="detail">' + esc(ev.reason||'') + ' <span class="sha">' + (ev.from||'').slice(0,7) + '</span> \\u2192 <span class="sha">' + (ev.to||'').slice(0,7) + '</span></span>';
      } else if (t === 'host.spawn') {
        body = cl + '<span class="type boot">spawn</span><span class="detail">pid ' + (ev.pid||'?') + ' <span class="sha">' + (ev.sha||'').slice(0,7) + '</span></span>';
      } else if (t === 'creature.boot') {
        body = cl + '<span class="type boot">creature boot</span><span class="detail"><span class="sha">' + (ev.sha||'').slice(0,7) + '</span></span>';
      } else if (t === 'host.boot') {
        body = cl + '<span class="type host">host boot</span>';
      } else {
        body = cl + '<span class="type host">' + esc(t) + '</span>';
      }

      return '<div class="event ' + cls + '"><span class="time">' + ts(ev.t) + '</span>' + body + '</div>';
    }

    // SSE
    const sse = new EventSource('/api/events');
    sse.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (selected === null || ev.creature === selected) {
        eventsEl.insertAdjacentHTML('beforeend', renderEvent(ev, selected === null));
        window.scrollTo(0, document.body.scrollHeight);
      }
    };

    async function select(name) {
      selected = name;
      eventsEl.innerHTML = '';
      if (name) {
        headerEl.innerHTML = '<h2>' + esc(name) + '</h2><div class="info" id="cinfo"></div>'
          + '<button class="btn" onclick="restartC(\\''+name+'\\')">restart</button>';
        msgBar.classList.add('visible');
        try {
          const res = await fetch('/api/creatures/' + name + '/events');
          const events = await res.json();
          for (const ev of events) {
            eventsEl.insertAdjacentHTML('beforeend', renderEvent(ev, false));
          }
          window.scrollTo(0, document.body.scrollHeight);
        } catch {}
      } else {
        headerEl.innerHTML = '<h2>all creatures</h2>';
        msgBar.classList.remove('visible');
      }
      renderSidebar();
    }

    function renderSidebar() {
      const names = Object.keys(creatures).sort();
      let html = '<div class="creature-item' + (selected === null ? ' selected' : '') + '" onclick="select(null)">'
        + '<span class="cname" style="color:#888">all</span></div>';
      for (const n of names) {
        const c = creatures[n];
        const sel = selected === n ? ' selected' : '';
        const dot = '<span class="dot ' + c.status + '"></span>';
        let act = '';
        if (c.status === 'stopped') {
          act = '<button class="btn" onclick="event.stopPropagation();startC(\\''+n+'\\')">start</button>';
        } else {
          act = '<button class="btn" onclick="event.stopPropagation();stopC(\\''+n+'\\')">stop</button>';
        }
        html += '<div class="creature-item' + sel + '" onclick="select(\\''+n+'\\')">'
          + dot + '<span class="cname">' + esc(n) + '</span>' + act + '</div>';
      }
      document.getElementById('creatures').innerHTML = html;
    }

    async function startC(n) { await fetch('/api/creatures/'+n+'/start',{method:'POST'}); refresh(); }
    async function stopC(n) { await fetch('/api/creatures/'+n+'/stop',{method:'POST'}); refresh(); }
    async function restartC(n) { await fetch('/api/creatures/'+n+'/restart',{method:'POST'}); refresh(); }
    async function sendMsg() {
      if (!selected) return;
      const inp = document.getElementById('msg');
      const text = inp.value.trim();
      if (!text) return;
      await fetch('/api/creatures/'+selected+'/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
      inp.value = '';
    }

    async function refresh() {
      try {
        const res = await fetch('/api/creatures');
        creatures = {};
        for (const c of await res.json()) creatures[c.name] = c;
        renderSidebar();
        if (selected && creatures[selected]) {
          const el = document.getElementById('cinfo');
          if (el) {
            const c = creatures[selected];
            el.innerHTML = '<span class="sha">' + (c.sha||'-').slice(0,7) + '</span> \\u00b7 ' + c.status;
          }
        }
      } catch {}
    }

    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`;
  }
}

// --- Entry point ---
const port = parseInt(process.env.ORCHESTRATOR_PORT || '7770');
const orchestrator = new Orchestrator(port);
orchestrator.start();
