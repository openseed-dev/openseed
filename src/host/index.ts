import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { Event } from '../shared/types.js';
import { CostTracker } from './costs.js';
import { Creator } from './creator.js';
import { EventStore } from './events.js';
import {
  CreatureSupervisor,
  SupervisorConfig,
} from './supervisor.js';
import { Watcher } from './watcher.js';

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
  private creator: Creator;
  private creatorRunning: Set<string> = new Set();
  private costs = new CostTracker();
  private watcher: Watcher;

  constructor(port: number) {
    this.port = port;
    this.creator = new Creator(this.costs);
    this.watcher = new Watcher(async (creature, reason) => {
      console.log(`[watcher] waking ${creature}: ${reason}`);
      const supervisor = this.supervisors.get(creature);
      if (!supervisor) return;
      try {
        await fetch(`http://127.0.0.1:${supervisor.port}/wake`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        });
      } catch (err) {
        console.error(`[watcher] failed to wake ${creature}:`, err);
      }
    });
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

    // Trigger Creator on deep sleep
    if (event.type === 'creature.dream' && (event as any).deep) {
      this.triggerCreator(name, 'deep_sleep').catch((err) => {
        console.error(`[creator] auto-trigger failed for ${name}:`, err);
      });
    }

    // Handle creature sleep with watch conditions
    if (event.type === 'creature.sleep' && (event as any).watch?.length) {
      const supervisor = this.supervisors.get(name);
      if (supervisor) {
        const containerName = `creature-${name}`;
        this.watcher.addWatch(name, containerName, (event as any).watch);
      }
    }

    // Handle creature autonomy: request_restart
    if (event.type === 'creature.request_restart') {
      const reason = (event as any).reason || 'creature requested restart';
      console.log(`[${name}] creature requested restart: ${reason}`);
      const supervisor = this.supervisors.get(name);
      const dir = path.join(CREATURES_DIR, name);
      if (supervisor) {
        try {
          execSync('npx tsx --check src/mind.ts src/index.ts', {
            cwd: dir, encoding: 'utf-8', timeout: 30_000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          execSync(`git add -A && git commit -m "creature: self-modification — ${reason.slice(0, 60)}" --allow-empty`, {
            cwd: dir, stdio: 'ignore',
          });
          // docker restart — process restarts, container environment preserved
          await supervisor.restart();
          console.log(`[${name}] creature-requested restart completed`);
        } catch (err: any) {
          const errMsg = err.stderr || err.stdout || err.message || 'unknown error';
          console.error(`[${name}] creature-requested restart failed: ${errMsg}`);
          try {
            await this.sendMessage(name, `[SYSTEM] Your restart request failed — TypeScript validation error:\n${errMsg.slice(0, 500)}\nFix the errors and try again.`);
          } catch {}
        }
      }
    }

    // Handle creature autonomy: request_evolution
    if (event.type === 'creature.request_evolution') {
      const reason = (event as any).reason || 'creature requested evolution';
      console.log(`[${name}] creature requested evolution: ${reason}`);
      this.triggerCreator(name, `creature_request: ${reason}`).catch((err) => {
        console.error(`[creator] creature-requested evolution failed for ${name}:`, err);
      });
    }
  }

  async triggerCreator(name: string, trigger: string): Promise<void> {
    if (this.creatorRunning.has(name)) {
      console.log(`[creator] already running for ${name}, skipping`);
      return;
    }

    const supervisor = this.supervisors.get(name);
    const store = this.stores.get(name);
    const dir = path.join(CREATURES_DIR, name);

    if (!supervisor || !store) {
      throw new Error(`creature "${name}" not found or not running`);
    }

    // Extract creature request from trigger string
    const creatureRequest = trigger.startsWith('creature_request: ')
      ? trigger.slice(18) : undefined;

    this.creatorRunning.add(name);
    try {
      await this.creator.evaluate(name, dir, store, supervisor, trigger, async (n, ev) => {
        await this.emitEvent(n, ev);
      }, creatureRequest);
    } finally {
      this.creatorRunning.delete(name);
    }
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

      // LLM proxy — creatures call this instead of api.anthropic.com
      if (p === '/v1/messages' && req.method === 'POST') {
        // Creature name encoded in the api key as "creature:<name>"
        const apiKeyHeader = req.headers['x-api-key'] as string || '';
        const creatureName = apiKeyHeader.startsWith('creature:') ? apiKeyHeader.slice(9) : (req.headers['x-creature-name'] as string || 'unknown');
        const body = await readBody(req);
        try {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) { res.writeHead(500); res.end('no API key configured'); return; }
          const upstream = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': req.headers['anthropic-version'] as string || '2023-06-01',
            },
            body,
          });
          const respBody = await upstream.text();
          // Track tokens
          try {
            const parsed = JSON.parse(respBody);
            if (parsed.usage) {
              this.costs.record(creatureName, parsed.usage.input_tokens || 0, parsed.usage.output_tokens || 0);
            }
          } catch {}
          res.writeHead(upstream.status, {
            'content-type': upstream.headers.get('content-type') || 'application/json',
          });
          res.end(respBody);
        } catch (err: any) {
          console.error(`[proxy] LLM proxy error for ${creatureName}:`, err.message);
          res.writeHead(502); res.end('proxy error');
        }
        return;
      }

      // Cost tracking API
      if (p === '/api/usage' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ usage: this.costs.getAll(), total: this.costs.getTotal() }));
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

        if (action === 'rebuild' && req.method === 'POST') {
          try {
            const supervisor = this.supervisors.get(name);
            if (!supervisor) throw new Error(`creature "${name}" is not running`);
            const dir = path.join(CREATURES_DIR, name);
            console.log(`[${name}] developer-initiated rebuild`);
            execSync(`docker build -t creature-${name} .`, {
              cwd: dir, stdio: 'ignore', timeout: 120_000,
            });
            await supervisor.rebuild();
            res.writeHead(200); res.end('ok');
          } catch (err: any) { res.writeHead(400); res.end(err.message); }
          return;
        }

        if (action === 'evolve' && req.method === 'POST') {
          try {
            this.triggerCreator(name, 'manual').catch((err) => {
              console.error(`[creator] manual trigger failed for ${name}:`, err);
            });
            res.writeHead(200); res.end('ok');
          } catch (err: any) { res.writeHead(400); res.end(err.message); }
          return;
        }

        if (action === 'wake' && req.method === 'POST') {
          try {
            const supervisor = this.supervisors.get(name);
            if (!supervisor) throw new Error(`creature "${name}" is not running`);
            const body = await readBody(req);
            const reason = body ? (JSON.parse(body).reason || 'Your creator woke you manually') : 'Your creator woke you manually';
            const res2 = await fetch(`http://127.0.0.1:${supervisor.port}/wake`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason }),
            });
            if (!res2.ok) throw new Error('creature rejected wake');
            console.log(`[${name}] force wake triggered: ${reason}`);
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

        if (action === 'files' && req.method === 'GET') {
          const dir = path.join(CREATURES_DIR, name);
          const read = async (f: string) => {
            try { return await fs.readFile(path.join(dir, f), 'utf-8'); } catch { return ''; }
          };
          const readJsonl = async (f: string, n: number) => {
            try {
              const content = await fs.readFile(path.join(dir, f), 'utf-8');
              const lines = content.trim().split('\n').filter(l => l);
              return lines.slice(-n).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
            } catch { return []; }
          };
          const files = {
            purpose: await read('PURPOSE.md'),
            diary: await read('self/diary.md'),
            observations: await read('.self/observations.md'),
            rules: await read('.self/rules.md'),
            dreams: await readJsonl('.self/dreams.jsonl', 10),
            creatorLog: await readJsonl('.self/creator-log.jsonl', 10),
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(files));
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
    .creature-cost { color: #f80; font-size: 10px; margin-left: 4px; flex-shrink: 0; }
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
      position: sticky; top: 0; z-index: 10; background: #0a0a0a;
      padding: 12px 16px; margin: -16px -16px 12px -16px; border-bottom: 1px solid #222;
      display: flex; align-items: center; gap: 12px;
    }
    .main-header h2 { color: #eee; font-size: 14px; margin: 0; }
    .main-header .info { color: #555; font-size: 12px; }
    .main-header .sha { color: #58f; }
    .sidebar-view-tabs {
      display: flex; gap: 4px; padding: 4px 12px 8px 28px;
    }
    .sidebar-view-tab {
      padding: 3px 10px; cursor: pointer; border-radius: 3px;
      background: #111; border: 1px solid #222; color: #666;
      font-family: inherit; font-size: 11px;
    }
    .sidebar-view-tab:hover { color: #aaa; border-color: #333; }
    .sidebar-view-tab.active { color: #58f; border-color: #58f; background: #1a1a2a; }
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
    .event.creature-progress-check { border-left-color: #f80; background: #1a1208; }
    .event.creator-evaluation { border-left-color: #0d4; background: #081a0a; }

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
    .event .type.progress-check { color: #f80; }
    .event .type.creator { color: #0d4; font-weight: bold; }
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

    /* view-switcher removed — tabs are now in the sticky header */

    .view { display: none; }
    .view.active { display: block; }

    .mind-tabs { display: flex; border-bottom: 1px solid #222; margin-bottom: 12px; }
    .mind-tab {
      padding: 8px 16px; cursor: pointer; color: #666;
      font-size: 12px; border-bottom: 2px solid transparent;
    }
    .mind-tab:hover { color: #aaa; }
    .mind-tab.active { color: #58f; border-bottom-color: #58f; }
    .mind-content {
      white-space: pre-wrap; word-break: break-word;
      font-size: 12px; color: #bbb; line-height: 1.5;
    }
    .mind-content .dream-entry { margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid #1a1a1a; }
    .mind-content .dream-entry:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .mind-content .dream-time { color: #666; font-size: 11px; }
    .mind-content .dream-deep { color: #c8f; font-size: 10px; font-weight: bold; margin-left: 6px; }
    .mind-content .dream-reflection { color: #ccc; margin-top: 4px; }
    .mind-content .obs-important { color: #e8e8e8; }
    .mind-content .obs-minor { color: #666; }
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
    <div class="view active" id="log-view">
      <div class="events" id="events"></div>
      <div class="message-bar" id="msgbar">
        <textarea id="msg" placeholder="Message to creature... (Cmd+Enter to send)" rows="2" onkeydown="if(event.key==='Enter'&&event.metaKey){event.preventDefault();sendMsg()}"></textarea>
        <button onclick="sendMsg()">Send</button>
      </div>
    </div>
    <div class="view" id="mind-view">
      <div class="mind-tabs" id="mtabs"></div>
      <div class="mind-content" id="mcontent"></div>
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

    function timeAgo(iso) {
      if (!iso) return '';
      const now = Date.now(), then = new Date(iso).getTime();
      const s = Math.floor((now - then) / 1000);
      if (s < 60) return 'just now';
      if (s < 3600) return Math.floor(s/60) + 'm ago';
      if (s < 86400) return Math.floor(s/3600) + 'h ago';
      if (s < 172800) return 'yesterday';
      return Math.floor(s/86400) + 'd ago';
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
      } else if (t === 'creature.progress_check') {
        body = cl + '<span class="type progress-check">progress check</span>'
          + '<span class="tool-ms">' + (ev.actions || 0) + ' actions</span>';
      } else if (t === 'creator.evaluation') {
        const oid = uid();
        const changes = (ev.changes || []);
        const label = changes.length > 0 ? 'creator evolved' : 'creator evaluated';
        body = cl + '<span class="type creator">' + label + '</span>'
          + (changes.length > 0 ? '<span class="tool-ms">' + changes.length + ' files changed</span>' : '')
          + '<span class="intent-text thought-summary" onclick="toggle(\\''+oid+'\\')"> \\u2014 ' + esc(summarize(ev.reasoning || '', 120)) + '</span>'
          + '<div class="thought-body" id="'+oid+'">'
          + '<strong>Trigger:</strong> ' + esc(ev.trigger || '') + '\\n\\n'
          + '<strong>Reasoning:</strong>\\n' + esc(ev.reasoning || '')
          + (changes.length > 0 ? '\\n\\n<strong>Changed files:</strong>\\n' + changes.map(f => '  - ' + esc(f)).join('\\n') : '')
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

    function isNearBottom() {
      return (window.innerHeight + window.scrollY) >= document.body.scrollHeight - 150;
    }

    // SSE
    const sse = new EventSource('/api/events');
    sse.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (selected === null || ev.creature === selected) {
        const wasNear = isNearBottom();
        eventsEl.insertAdjacentHTML('beforeend', renderEvent(ev, selected === null));
        if (wasNear) window.scrollTo(0, document.body.scrollHeight);
      }
    };

    let currentView = 'log';
    let mindData = null;
    let mindTab = 'purpose';
    const logView = document.getElementById('log-view');
    const mindView = document.getElementById('mind-view');
    const mtabs = document.getElementById('mtabs');
    const mcontent = document.getElementById('mcontent');

    function switchView(v) {
      currentView = v;
      logView.classList.toggle('active', v === 'log');
      mindView.classList.toggle('active', v === 'mind');
      renderSidebar();
      if (v === 'mind' && selected) {
        if (!mindData) loadMind().then(renderMind);
        else renderMind();
      }
    }

    async function select(name) {
      selected = name;
      eventsEl.innerHTML = '';
      mindData = null;
      currentView = 'log';
      if (name) {
        headerEl.innerHTML = '<h2>' + esc(name) + '</h2><div class="info" id="cinfo"></div>'
          + '<button class="btn" onclick="wakeC(\\''+name+'\\')">wake</button>'
          + '<button class="btn" onclick="restartC(\\''+name+'\\')">restart</button>'
          + '<button class="btn" style="color:#f80;border-color:#f80" onclick="rebuildC(\\''+name+'\\')">rebuild</button>'
          + '<button class="btn" style="color:#0d4;border-color:#0d4" onclick="evolveC(\\''+name+'\\')">evolve</button>';
        msgBar.classList.add('visible');
        switchView('log');
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
        switchView('log');
      }
      renderSidebar();
    }

    async function loadMind() {
      if (!selected) return;
      try {
        const res = await fetch('/api/creatures/' + selected + '/files');
        mindData = await res.json();
      } catch { mindData = {}; }
    }

    function selectMindTab(tab) {
      mindTab = tab;
      renderMind();
    }

    function renderMind() {
      if (!mindData) { mcontent.innerHTML = 'Loading...'; return; }
      const tabs = ['purpose','observations','rules','dreams','diary','creator'];
      mtabs.innerHTML = tabs.map(t =>
        '<div class="mind-tab' + (mindTab === t ? ' active' : '') + '" onclick="selectMindTab(\\''+t+'\\')">' + t + '</div>'
      ).join('') + '<div class="mind-tab" onclick="loadMind().then(renderMind)" style="margin-left:auto;color:#444">\\u21bb</div>';

      let html = '';
      if (mindTab === 'purpose') {
        html = esc(mindData.purpose || 'No PURPOSE.md');
      } else if (mindTab === 'diary') {
        html = esc(mindData.diary || 'No diary entries yet.');
      } else if (mindTab === 'rules') {
        html = esc(mindData.rules || 'No rules yet.');
      } else if (mindTab === 'observations') {
        const obs = mindData.observations || '';
        html = obs ? obs.split('\\n').map(l => {
          if (l.startsWith('RED')) return '<span style="color:#f55">' + esc(l) + '</span>';
          if (l.startsWith('YLW')) return '<span style="color:#fa0">' + esc(l) + '</span>';
          if (l.startsWith('GRN')) return '<span style="color:#666">' + esc(l) + '</span>';
          if (l.startsWith('[!]')) return '<span class="obs-important">' + esc(l) + '</span>';
          if (l.startsWith('[.]')) return '<span class="obs-minor">' + esc(l) + '</span>';
          return esc(l);
        }).join('\\n') : 'No observations yet.';
      } else if (mindTab === 'dreams') {
        const dreams = mindData.dreams || [];
        if (dreams.length === 0) { html = 'No dreams yet.'; }
        else {
          html = dreams.map(d =>
            '<div class="dream-entry">'
            + '<span class="dream-time">' + timeAgo(d.t) + ' \\u2014 ' + (d.actions||0) + ' actions</span>'
            + (d.deep ? '<span class="dream-deep">deep sleep</span>' : '')
            + '\\n<span class="dream-reflection">' + esc(d.reflection || '') + '</span>'
            + '</div>'
          ).reverse().join('');
        }
      } else if (mindTab === 'creator') {
        const logs = mindData.creatorLog || [];
        if (logs.length === 0) { html = 'No creator evaluations yet.'; }
        else {
          html = logs.map(e =>
            '<div class="dream-entry">'
            + '<span class="dream-time">' + (e.t || '').slice(0,16) + ' \\u2014 trigger: ' + esc(e.trigger || '') + (e.changed ? ' \\u2014 <span style="color:#0d4">changed</span>' : ' \\u2014 no changes') + '</span>\\n'
            + '<span class="dream-reflection">' + esc(e.reasoning || '') + '</span>'
            + (e.changes && e.changes.length > 0 ? '\\n<span style="color:#0d4">Files: ' + e.changes.map(c => esc(c.file || c)).join(', ') + '</span>' : '')
            + '</div>'
          ).reverse().join('');
        }
      }
      mcontent.innerHTML = html;
    }

    function fmtCost(usd) { return usd < 0.01 ? '<$0.01' : '$' + usd.toFixed(2); }
    function creatureCost(n) {
      const c = usageData[n] || { cost_usd: 0 };
      const cr = usageData['creator:' + n] || { cost_usd: 0 };
      return c.cost_usd + cr.cost_usd;
    }

    function renderSidebar() {
      const names = Object.keys(creatures).sort();
      let html = '<div class="creature-item' + (selected === null ? ' selected' : '') + '" onclick="select(null)">'
        + '<span class="cname" style="color:#888">all</span></div>';
      for (const n of names) {
        const c = creatures[n];
        const sel = selected === n ? ' selected' : '';
        const dot = '<span class="dot ' + c.status + '"></span>';
        const cost = creatureCost(n);
        const costLabel = cost > 0 ? '<span class="creature-cost">' + fmtCost(cost) + '</span>' : '';
        let act = '';
        if (c.status === 'stopped') {
          act = '<button class="btn" onclick="event.stopPropagation();startC(\\''+n+'\\')">start</button>';
        } else {
          act = '<button class="btn" onclick="event.stopPropagation();stopC(\\''+n+'\\')">stop</button>';
        }
        html += '<div class="creature-item' + sel + '" onclick="select(\\''+n+'\\')">'
          + dot + '<span class="cname">' + esc(n) + '</span>' + costLabel + act + '</div>';
        if (selected === n) {
          html += '<div class="sidebar-view-tabs">'
            + '<button class="sidebar-view-tab' + (currentView === 'log' ? ' active' : '') + '" onclick="event.stopPropagation();switchView(\\'log\\')">log</button>'
            + '<button class="sidebar-view-tab' + (currentView === 'mind' ? ' active' : '') + '" onclick="event.stopPropagation();switchView(\\'mind\\')">mind</button>'
            + '</div>';
        }
      }
      if (totalCost > 0) {
        html += '<div style="padding:12px;border-top:1px solid #222;color:#666;font-size:11px;text-align:right;">total: <span style="color:#f80">' + fmtCost(totalCost) + '</span></div>';
      }
      document.getElementById('creatures').innerHTML = html;
    }

    async function startC(n) { await fetch('/api/creatures/'+n+'/start',{method:'POST'}); refresh(); }
    async function stopC(n) { await fetch('/api/creatures/'+n+'/stop',{method:'POST'}); refresh(); }
    async function restartC(n) { await fetch('/api/creatures/'+n+'/restart',{method:'POST'}); refresh(); }
    async function rebuildC(n) { if(confirm('Rebuild destroys the container environment. Continue?')) { await fetch('/api/creatures/'+n+'/rebuild',{method:'POST'}); refresh(); } }
    async function wakeC(n) { await fetch('/api/creatures/'+n+'/wake',{method:'POST'}); }
    async function evolveC(n) { await fetch('/api/creatures/'+n+'/evolve',{method:'POST'}); }
    async function sendMsg() {
      if (!selected) return;
      const inp = document.getElementById('msg');
      const text = inp.value.trim();
      if (!text) return;
      await fetch('/api/creatures/'+selected+'/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
      inp.value = '';
    }

    let usageData = {};
    let totalCost = 0;

    async function refresh() {
      try {
        const [crRes, usRes] = await Promise.all([fetch('/api/creatures'), fetch('/api/usage')]);
        creatures = {};
        for (const c of await crRes.json()) creatures[c.name] = c;
        const ud = await usRes.json();
        usageData = ud.usage || {};
        totalCost = ud.total || 0;
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
