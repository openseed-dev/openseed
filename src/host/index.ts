import {
  exec,
  execSync,
} from 'node:child_process';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Event } from '../shared/types.js';
import { CostTracker } from './costs.js';
import { Creator } from './creator.js';
import { EventStore } from './events.js';
import { handleLLMProxy } from './proxy.js';
import {
  CreatureSupervisor,
  SupervisorConfig,
} from './supervisor.js';

const execAsync = promisify(exec);

const ITSALIVE_HOME = path.join(os.homedir(), '.itsalive');
const CREATURES_DIR = path.join(ITSALIVE_HOME, 'creatures');
const ARCHIVE_DIR = path.join(ITSALIVE_HOME, 'archive');

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

const COPY_SKIP = new Set(['node_modules', '.git', '.self', '.sys']);
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    if (COPY_SKIP.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

export class Orchestrator {
  private port: number;
  private supervisors: Map<string, CreatureSupervisor> = new Map();
  private stores: Map<string, EventStore> = new Map();
  private globalListeners: Set<(name: string, event: Event) => void> = new Set();
  private creator: Creator;
  private creatorRunning: Set<string> = new Set();
  private costs = new CostTracker();
  private dashboardHtml: string;

  constructor(port: number) {
    this.port = port;
    this.creator = new Creator(this.costs);
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    this.dashboardHtml = readFileSync(path.join(thisDir, 'dashboard.html'), 'utf-8');
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

  async startCreature(name: string, opts?: { manual?: boolean }): Promise<void> {
    if (this.supervisors.has(name)) throw new Error(`creature "${name}" is already running`);

    const dir = path.join(CREATURES_DIR, name);
    try { await fs.access(path.join(dir, 'BIRTH.json')); }
    catch { throw new Error(`creature "${name}" not found`); }

    const sandboxed = this.isDockerAvailable() && this.hasDockerImage(name);
    const autoIterate = !(opts?.manual);
    const existingPort = sandboxed ? this.getContainerPort(name) : null;
    const port = existingPort || await this.allocatePort();

    console.log(`[orchestrator] starting ${name} (${sandboxed ? 'docker' : 'no image — building required'}) on port ${port}${existingPort ? ' (existing container)' : ''}`); 
    await this.startCreatureInternal(name, dir, port, { sandboxed, autoIterate });
  }

  private async startCreatureInternal(
    name: string, dir: string, port: number,
    opts: { sandboxed: boolean; autoIterate: boolean },
  ) {
    const store = new EventStore(dir);
    await store.init();
    this.stores.set(name, store);

    // Read model from BIRTH.json if present
    let model: string | undefined;
    try {
      const birth = JSON.parse(await fs.readFile(path.join(dir, 'BIRTH.json'), 'utf-8'));
      model = birth.model;
    } catch {}

    const config: SupervisorConfig = {
      name, dir, port,
      orchestratorPort: this.port,
      autoIterate: opts.autoIterate,
      sandboxed: opts.sandboxed,
      model,
    };

    const supervisor = new CreatureSupervisor(config, async (n, event) => {
      await this.emitEvent(n, event);
    });

    this.supervisors.set(name, supervisor);
    await supervisor.start();

    // Recover creature status from event history (fixes stale "running" after orchestrator restart)
    try {
      const recent = await store.readRecent(50);
      for (let i = recent.length - 1; i >= 0; i--) {
        const t = recent[i].type;
        if (t === 'creature.sleep') {
          supervisor.status = 'sleeping';
          console.log(`[${name}] recovered status: sleeping (from event history)`);
          break;
        }
        if (t === 'creature.tool_call' || t === 'creature.wake' || t === 'creature.boot') {
          break; // creature is active, "running" is correct
        }
      }
    } catch {}
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

  async spawnCreature(name: string, dir: string, purpose?: string, template = 'dreamer', model?: string): Promise<void> {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const tpl = path.resolve(thisDir, '..', '..', 'templates', template);
    try { await fs.access(tpl); } catch { throw new Error(`template "${template}" not found at ${tpl}`); }

    await fs.mkdir(CREATURES_DIR, { recursive: true });
    await copyDir(tpl, dir);

    const birth: Record<string, unknown> = {
      id: crypto.randomUUID(),
      name,
      born: new Date().toISOString(),
      template: template,
      template_version: '0.0.0',
      parent: null,
    };
    if (model) birth.model = model;
    await fs.writeFile(path.join(dir, 'BIRTH.json'), JSON.stringify(birth, null, 2) + '\n');

    if (purpose) {
      await fs.writeFile(path.join(dir, 'PURPOSE.md'), `# Purpose\n\n${purpose}\n`);
    }

    console.log(`[orchestrator] spawning "${name}" — installing deps...`);
    await execAsync('pnpm install --silent', { cwd: dir });

    await execAsync('git init', { cwd: dir });
    await execAsync('git add -A', { cwd: dir });
    await execAsync('git commit -m "genesis"', { cwd: dir });

    if (!this.isDockerAvailable()) throw new Error('docker is required but not available');
    console.log(`[orchestrator] spawning "${name}" — building docker image...`);
    await execAsync(`docker build -t creature-${name} .`, { cwd: dir, maxBuffer: 10 * 1024 * 1024 });
    console.log(`[orchestrator] creature "${name}" spawned`);
  }

  async archiveCreature(name: string): Promise<void> {
    const dir = path.join(CREATURES_DIR, name);
    try { await fs.access(path.join(dir, 'BIRTH.json')); }
    catch { throw new Error(`creature "${name}" not found`); }

    // Stop if running
    if (this.supervisors.has(name)) {
      await this.stopCreature(name);
    }
    // Docker cleanup — remove container and image but keep files
    try { await execAsync(`docker kill creature-${name}`); } catch {}
    try { await execAsync(`docker rm -f creature-${name}`); } catch {}
    try { await execAsync(`docker rmi creature-${name}`); } catch {}

    await fs.mkdir(ARCHIVE_DIR, { recursive: true });
    const dest = path.join(ARCHIVE_DIR, name);
    // If already archived under that name, append timestamp
    try { await fs.access(dest); await fs.rename(dir, dest + '-' + Date.now()); }
    catch { await fs.rename(dir, dest); }

    console.log(`[orchestrator] creature "${name}" archived to ${ARCHIVE_DIR}`);
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

    // Handle creature autonomy: request_restart
    if (event.type === 'creature.request_restart') {
      const reason = (event as any).reason || 'creature requested restart';
      console.log(`[${name}] creature requested restart: ${reason}`);
      const supervisor = this.supervisors.get(name);
      const dir = path.join(CREATURES_DIR, name);
      if (supervisor) {
        try {
          await execAsync('npx tsx --check src/mind.ts src/index.ts', {
            cwd: dir, timeout: 30_000,
          });
          await execAsync(`git add -A && git commit -m "creature: self-modification — ${reason.slice(0, 60)}" --allow-empty`, {
            cwd: dir,
          });
          // docker restart — process restarts, container environment preserved
          await supervisor.restart();
          console.log(`[${name}] creature-requested restart completed`);
        } catch (err: any) {
          const errMsg = err.stderr || err.stdout || err.message || 'unknown error';
          console.error(`[${name}] creature-requested restart failed: ${errMsg}`);
          try {
            await this.sendMessage(name, `[SYSTEM] Your restart request failed — TypeScript validation error:\n${errMsg.slice(0, 500)}\nFix the errors and try again.`, 'system');
          } catch {}
        }
      }
    }

    // Auto-apply code changes on sleep
    if (event.type === 'creature.sleep') {
      const dir = path.join(CREATURES_DIR, name);
      try {
        // Check for uncommitted changes in src/
        const { stdout: diff } = await execAsync('git diff --name-only src/', { cwd: dir });
        if (diff.trim()) {
          console.log(`[${name}] uncommitted code changes on sleep, validating...`);
          try {
            await execAsync('npx tsx --check src/mind.ts src/index.ts', {
              cwd: dir, timeout: 30_000,
            });
            await execAsync(
              'git add -A && git commit -m "creature: self-modification on sleep"',
              { cwd: dir },
            );
          } catch (err: any) {
            const errMsg = err.stderr || err.stdout || err.message || 'unknown';
            console.error(`[${name}] code validation failed on sleep: ${errMsg}`);
            await execAsync('git checkout -- src/', { cwd: dir }).catch(() => {});
            try {
              await this.sendMessage(
                name,
                `[SYSTEM] Your code changes failed validation and were reverted:\n${errMsg.slice(0, 500)}`,
                'system',
              );
            } catch {}
          }
        }

        // Restart if HEAD has moved since the creature last started
        const supervisor = this.supervisors.get(name);
        if (supervisor) {
          const { stdout: headSHA } = await execAsync('git rev-parse HEAD', { cwd: dir });
          const info = supervisor.getInfo();
          if (headSHA.trim() !== info.sha) {
            console.log(`[${name}] code updated (${info.sha?.slice(0, 7)} → ${headSHA.trim().slice(0, 7)}), restarting to apply`);
            await supervisor.restart();
          }
        }
      } catch {}
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

  async sendMessage(name: string, text: string, source: 'user' | 'creator' | 'system' = 'user'): Promise<void> {
    const supervisor = this.supervisors.get(name);
    if (!supervisor) throw new Error(`creature "${name}" is not running`);

    const res = await fetch(`http://127.0.0.1:${supervisor.port}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) throw new Error(`creature rejected message: ${await res.text()}`);
    await this.emitEvent(name, { t: new Date().toISOString(), type: 'creature.message', text, source });
    console.log(`[${name}] message (${source}): ${text.slice(0, 80)}`);
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
        res.end(this.dashboardHtml);
        return;
      }

      // LLM proxy — creatures call this instead of api.anthropic.com
      // Detects model from request body, routes to Anthropic or OpenAI (with translation)
      if (p === '/v1/messages' && req.method === 'POST') {
        await handleLLMProxy(req, res, this.costs);
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

      if (p === '/api/creatures' && req.method === 'POST') {
        try {
          const body = JSON.parse(await readBody(req));
          const name = (body.name || '').trim();
          const purpose = (body.purpose || '').trim();
          const template = (body.template || 'dreamer').trim();
          const model = (body.model || '').trim() || undefined;
          if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('invalid name (lowercase alphanumeric + hyphens)');
          const dir = path.join(CREATURES_DIR, name);
          try { await fs.access(dir); throw new Error(`creature "${name}" already exists`); } catch (e: any) { if (e.message.includes('already exists')) throw e; }

          // Return 202 immediately — spawn runs in background
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, name, status: 'spawning' }));

          await this.emitEvent(name, { type: 'creature.spawning', t: new Date().toISOString() } as any);
          this.spawnCreature(name, dir, purpose, template, model).then(async () => {
            console.log(`[orchestrator] creature "${name}" ready`);
            await this.emitEvent(name, { type: 'creature.spawned', t: new Date().toISOString() } as any);
          }).catch(async (err) => {
            console.error(`[orchestrator] spawn failed for "${name}":`, err);
            await this.emitEvent(name, { type: 'creature.spawn_failed', t: new Date().toISOString(), error: err.message } as any);
          });
        } catch (err: any) { res.writeHead(400); res.end(err.message); }
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
            await execAsync(`docker build -t creature-${name} .`, {
              cwd: dir, timeout: 120_000, maxBuffer: 10 * 1024 * 1024,
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
            await this.emitEvent(name, { t: new Date().toISOString(), type: 'creature.wake', reason, source: 'manual' });
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
            // Always attempt to wake — forceWake() is a no-op if not sleeping,
            // and supervisor may lose sleeping status on orchestrator restart
            const sup = this.supervisors.get(name);
            if (sup?.port) {
              const reason = `Message from user: ${text.slice(0, 100)}`;
              try {
                const wakeRes = await fetch(`http://127.0.0.1:${sup.port}/wake`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ reason }),
                });
                const wakeBody = await wakeRes.text();
                // "woken" = new protocol, "ok" = legacy (always returned)
                if (wakeBody === 'woken') {
                  await this.emitEvent(name, { t: new Date().toISOString(), type: 'creature.wake', reason, source: 'manual' });
                }
              } catch {}
            }
            res.writeHead(200); res.end('ok');
          } catch (err: any) { res.writeHead(400); res.end(err.message); }
          return;
        }

        if (action === 'archive' && req.method === 'POST') {
          try {
            await this.archiveCreature(name);
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
}

// --- Entry point ---
const port = parseInt(process.env.ORCHESTRATOR_PORT || '7770');
const orchestrator = new Orchestrator(port);
orchestrator.start();
