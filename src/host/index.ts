import {
  exec,
  execSync,
} from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  BUNDLED_GENOMES_DIR,
  CREATURES_DIR,
  GENOMES_DIR,
  OPENSEED_HOME,
} from '../shared/paths.js';
import { spawnCreature } from '../shared/spawn.js';
import { sendErrorResponse, sendJsonErrorResponse } from './http-error-handler.js';
import { Event } from '../shared/types.js';
import {
  getSpendingCap,
  loadGlobalConfig,
  saveCreatureSpendingCap,
  saveGlobalSpendingCap,
  saveNarratorConfig,
} from './config.js';
import { CostTracker } from './costs.js';
import { EventStore } from './events.js';
import { startJanee, stopJanee } from './janee.js';
import { Narrator } from './narrator.js';
import type { BudgetCheckResult } from './proxy.js';
import { handleLLMProxy } from './proxy.js';
import {
  CreatureSupervisor,
  SupervisorConfig,
} from './supervisor.js';

const execAsync = promisify(exec);

const ARCHIVE_DIR = path.join(OPENSEED_HOME, 'archive');
const IS_DOCKER = process.env.OPENSEED_DOCKER === '1' || process.env.ITSALIVE_DOCKER === '1';

function creatureUrl(name: string, port: number, urlPath: string): string {
  if (IS_DOCKER) return `http://creature-${name}:7778${urlPath}`;
  return `http://127.0.0.1:${port}${urlPath}`;
}

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
  private costs = new CostTracker();
  private pendingOps: Set<string> = new Set();
  private narrator: Narrator | null = null;
  private dashboardHtml: string;
  private dashboardDistDir: string | null;
  private budgetResetInterval: NodeJS.Timeout | null = null;

  constructor(port: number) {
    this.port = port;
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    this.dashboardHtml = readFileSync(path.join(thisDir, 'dashboard.html'), 'utf-8');
    const distDir = path.resolve(thisDir, '../../dashboard/dist');
    this.dashboardDistDir = existsSync(path.join(distDir, 'index.html')) ? distDir : null;
  }

  async start() {
    console.log('[orchestrator] starting...');
    await this.writeRunFile();
    this.setupCleanup();
    this.createServer();
    await startJanee();
    await this.autoReconnect();
    this.budgetResetInterval = setInterval(() => this.checkBudgetResets(), 60_000);

    const narratorConfig = loadGlobalConfig().narrator;
    this.narrator = new Narrator(
      narratorConfig,
      () => this.listCreatures(),
      (name, event) => this.emitEvent(name, event),
      this.costs,
    );
    this.globalListeners.add((name, event) => this.narrator?.onEvent(name, event));
    this.narrator.start();

    console.log(`[orchestrator] ready at http://localhost:${this.port}`);
  }

  // --- Lifecycle ---

  private async writeRunFile() {
    await fs.mkdir(OPENSEED_HOME, { recursive: true });
    await fs.writeFile(
      path.join(OPENSEED_HOME, 'orchestrator.json'),
      JSON.stringify({ port: this.port, pid: process.pid, started_at: new Date().toISOString() }, null, 2) + '\n',
      'utf-8',
    );
  }

  private setupCleanup() {
    const cleanup = async () => {
      if (this.budgetResetInterval) clearInterval(this.budgetResetInterval);
      this.narrator?.stop();
      stopJanee();
      try { await fs.unlink(path.join(OPENSEED_HOME, 'orchestrator.json')); } catch {}
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
      if (!this.isContainerRunning(name)) continue;
      const port = this.getContainerPort(name);
      if (port) {
        console.log(`[orchestrator] found running container for ${name} on port ${port}`);
        await this.startCreatureInternal(name, dir, port, { autoIterate: true });
      }
    }
  }

  private isContainerRunning(name: string): boolean {
    try {
      const out = execSync(
        `docker inspect -f '{{.State.Running}}' creature-${name}`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      return out === 'true';
    } catch { return false; }
  }

  private getContainerPort(name: string): number | null {
    // Running container: docker port returns mapped host port
    try {
      const out = execSync(`docker port creature-${name} 7778`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      const port = parseInt(out.split(':').pop()!);
      if (!isNaN(port)) return port;
    } catch {}
    // Stopped container: inspect HostConfig for the original port binding
    try {
      const out = execSync(
        `docker inspect -f '{{(index (index .HostConfig.PortBindings "7778/tcp") 0).HostPort}}' creature-${name}`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      const port = parseInt(out);
      if (!isNaN(port)) return port;
    } catch {}
    return null;
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
    const existing = this.supervisors.get(name);
    if (existing && existing.sleepReason === 'budget') {
      console.log(`[${name}] restarting from budget pause`);
      await existing.start();
      return;
    }
    if (existing) throw new Error(`creature "${name}" is already running`);
    if (this.pendingOps.has(name)) throw new Error(`creature "${name}" is already starting`);

    const dir = path.join(CREATURES_DIR, name);
    try { await fs.access(path.join(dir, 'BIRTH.json')); }
    catch { throw new Error(`creature "${name}" not found`); }

    if (!this.isDockerAvailable()) throw new Error('docker is required but not available');

    this.pendingOps.add(name);
    try {
      if (!this.hasDockerImage(name)) {
        console.log(`[orchestrator] no docker image for ${name}, building...`);
        await execAsync(`docker build -t creature-${name} .`, { cwd: dir, maxBuffer: 10 * 1024 * 1024 });
      }

      const autoIterate = !(opts?.manual);
      const existingPort = this.getContainerPort(name);
      const port = existingPort || await this.allocatePort();

      console.log(`[orchestrator] starting ${name} on port ${port}${existingPort ? ' (existing container)' : ''}`);
      await this.startCreatureInternal(name, dir, port, { autoIterate });
    } finally {
      this.pendingOps.delete(name);
    }
  }

  private async startCreatureInternal(
    name: string, dir: string, port: number,
    opts: { autoIterate: boolean },
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

  async spawnCreature(name: string, _dir: string, purpose?: string, genome = 'dreamer', model?: string): Promise<void> {
    console.log(`[orchestrator] spawning "${name}"...`);
    const result = await spawnCreature({ name, purpose, genome, model });
    console.log(`[orchestrator] creature "${result.name}" spawned (${result.genome} ${result.genome_version})`);
  }

  async archiveCreature(name: string): Promise<void> {
    const dir = path.join(CREATURES_DIR, name);
    try { await fs.access(path.join(dir, 'BIRTH.json')); }
    catch { throw new Error(`creature "${name}" not found`); }

    // Stop if running
    if (this.supervisors.has(name)) {
      await this.stopCreature(name);
    }
    // Docker cleanup: remove container and image but keep files
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

    // Handle creature autonomy: request_restart
    if (event.type === 'creature.request_restart') {
      const reason = (event as any).reason || 'creature requested restart';
      console.log(`[${name}] creature requested restart: ${reason}`);
      const supervisor = this.supervisors.get(name);
      const dir = path.join(CREATURES_DIR, name);
      if (supervisor) {
        try {
          // Read validate from BIRTH.json (set at spawn time, immutable to the creature)
          // rather than genome.json which the creature can modify.
          let validate: string | undefined;
          try {
            const birth = JSON.parse(await fs.readFile(path.join(dir, 'BIRTH.json'), 'utf-8'));
            validate = birth.validate;
          } catch {}
          if (validate) {
            await execAsync(validate, { cwd: dir, timeout: 30_000 });
          }
          await execAsync(`git add -A && git commit -m "creature: self-modification, ${reason.slice(0, 60)}" --allow-empty`, {
            cwd: dir,
          });
          // docker restart: process restarts, container environment preserved
          await supervisor.restart();
          console.log(`[${name}] creature-requested restart completed`);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : (err && typeof err === 'object' && 'stderr' in err ? String((err as any).stderr) : String(err || 'unknown error'));
          console.error(`[${name}] creature-requested restart failed: ${errMsg}`);
          try {
            await this.sendMessage(name, `[SYSTEM] Your restart request failed. TypeScript validation error:\n${errMsg.slice(0, 500)}\nFix the errors and try again.`, 'system');
          } catch {}
        }
      }
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

  async sendMessage(name: string, text: string, source: 'user' | 'system' = 'user'): Promise<void> {
    const supervisor = this.supervisors.get(name);
    if (!supervisor) throw new Error(`creature "${name}" is not running`);

    const res = await fetch(creatureUrl(name, supervisor.port, '/message'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) throw new Error(`creature rejected message: ${await res.text()}`);
    await this.emitEvent(name, { t: new Date().toISOString(), type: 'creature.message', text, source });
    console.log(`[${name}] message (${source}): ${text.slice(0, 80)}`);
  }

  async listCreatures(): Promise<Array<{ name: string; status: string; sha: string | null; port: number | null; sleepReason: string | null; model: string | null }>> {
    const all = await this.discoverCreatures();
    return Promise.all(all.map(async ({ name, dir }) => {
      const sup = this.supervisors.get(name);
      if (sup) {
        const info = sup.getInfo();
        return { name, status: info.status, sha: info.sha, port: info.port, sleepReason: info.sleepReason, model: info.model };
      }
      let model: string | null = null;
      try {
        const birth = JSON.parse(await fs.readFile(path.join(dir, 'BIRTH.json'), 'utf-8'));
        model = birth.model || null;
      } catch {}
      const status = this.pendingOps.has(name) ? 'spawning' : 'stopped';
      return { name, status, sha: null, port: null, sleepReason: null, model };
    }));
  }

  // --- Budget enforcement ---

  private checkCreatureBudget(name: string): BudgetCheckResult {
    const cap = getSpendingCap(name);
    if (cap.action === 'off') return { allowed: true, action: 'off', dailyCap: cap.daily_usd, dailySpent: 0 };
    const dailySpent = this.costs.getCreatureDailyCost(name);
    return { allowed: dailySpent < cap.daily_usd, action: cap.action, dailyCap: cap.daily_usd, dailySpent };
  }

  private async handleBudgetExceeded(name: string): Promise<void> {
    const supervisor = this.supervisors.get(name);
    if (!supervisor || supervisor.sleepReason === 'budget') return;
    console.log(`[${name}] budget exceeded, pausing creature`);
    await supervisor.budgetPause();
    await this.emitEvent(name, {
      t: new Date().toISOString(),
      type: 'budget.exceeded',
      daily_spent: this.costs.getCreatureDailyCost(name),
      daily_cap: getSpendingCap(name).daily_usd,
    } as any);
  }

  private async checkBudgetResets() {
    for (const [name, supervisor] of this.supervisors) {
      if (supervisor.sleepReason !== 'budget') continue;
      const dailySpent = this.costs.getCreatureDailyCost(name);
      if (dailySpent === 0) {
        console.log(`[${name}] daily budget reset, waking creature`);
        try {
          await supervisor.start();
          await this.emitEvent(name, { t: new Date().toISOString(), type: 'budget.reset' } as any);
        } catch (err: unknown) {
          console.error(`[${name}] failed to wake after budget reset:`, err instanceof Error ? err.message : String(err));
        }
      }
    }
  }

  // --- HTTP Server ---

  private createServer() {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${this.port}`);
      const p = url.pathname;

      if (req.method === 'GET' && this.dashboardDistDir) {
        const filePath = p === '/' ? '/index.html' : p;
        const fullPath = path.join(this.dashboardDistDir, filePath);
        if (fullPath.startsWith(this.dashboardDistDir) && existsSync(fullPath)) {
          const ext = path.extname(fullPath);
          const mimeTypes: Record<string, string> = {
            '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
            '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
            '.woff2': 'font/woff2', '.woff': 'font/woff',
          };
          res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
          res.end(readFileSync(fullPath));
          return;
        }
      }

      if (p === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(this.dashboardHtml);
        return;
      }

      // LLM proxy: creatures call this instead of api.anthropic.com
      // Detects model from request body, routes to Anthropic or OpenAI (with translation)
      if (p === '/v1/messages' && req.method === 'POST') {
        await handleLLMProxy(
          req, res, this.costs,
          (name) => this.checkCreatureBudget(name),
          (name) => { this.handleBudgetExceeded(name).catch(err => console.error(`[${name}] budget pause error:`, err)); },
          (name, model) => {
            const sup = this.supervisors.get(name);
            if (sup && !sup.getInfo().model) sup.setModel(model);
          },
        );
        return;
      }

      // Cost tracking API
      if (p === '/api/usage' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ usage: this.costs.getAll(), total: this.costs.getTotal() }));
        return;
      }

      if (p === '/api/budget' && req.method === 'GET') {
        const cap = loadGlobalConfig().spending_cap;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ daily_usd: cap.daily_usd, action: cap.action }));
        return;
      }

      if (p === '/api/budget' && req.method === 'PUT') {
        try {
          const body = await new Promise<string>((resolve) => {
            let data = ''; req.on('data', (c) => data += c); req.on('end', () => resolve(data));
          });
          const update = JSON.parse(body);
          const patch: Record<string, any> = {};
          if (typeof update.daily_usd === 'number' && update.daily_usd >= 0) patch.daily_usd = update.daily_usd;
          if (['sleep', 'warn', 'off'].includes(update.action)) patch.action = update.action;
          if (Object.keys(patch).length === 0) { res.writeHead(400); res.end('nothing to update'); return; }
          saveGlobalSpendingCap(patch);
          const cap = loadGlobalConfig().spending_cap;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ daily_usd: cap.daily_usd, action: cap.action }));
        } catch (err) { sendErrorResponse(res, err); }
        return;
      }

      if (p === '/api/narrator/config' && req.method === 'GET') {
        const nar = loadGlobalConfig().narrator;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(nar));
        return;
      }

      if (p === '/api/narrator/config' && req.method === 'PUT') {
        try {
          const body = await new Promise<string>((resolve) => {
            let data = ''; req.on('data', (c) => data += c); req.on('end', () => resolve(data));
          });
          const update = JSON.parse(body);
          const patch: Record<string, any> = {};
          if (typeof update.enabled === 'boolean') patch.enabled = update.enabled;
          if (typeof update.model === 'string' && update.model) patch.model = update.model;
          if (typeof update.interval_minutes === 'number' && update.interval_minutes >= 1) patch.interval_minutes = update.interval_minutes;
          if (Object.keys(patch).length === 0) { res.writeHead(400); res.end('nothing to update'); return; }
          saveNarratorConfig(patch);
          const nar = loadGlobalConfig().narrator;
          if (this.narrator) this.narrator.updateConfig(nar);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(nar));
        } catch (err) { sendErrorResponse(res, err); }
        return;
      }

      if (p === '/api/narration' && req.method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '20');
        const entries = this.narrator ? await this.narrator.readRecent(Math.min(limit, 100)) : [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(entries));
        return;
      }

      if (p === '/api/genomes' && req.method === 'GET') {
        try {
          const genomes: Array<{ name: string; description?: string; source: string }> = [];
          const seen = new Set<string>();

          const scanDir = async (dir: string, source: string) => {
            try {
              const entries = await fs.readdir(dir, { withFileTypes: true });
              for (const e of entries) {
                if (!e.isDirectory() || seen.has(e.name)) continue;
                try {
                  const gj = JSON.parse(await fs.readFile(path.join(dir, e.name, 'genome.json'), 'utf-8'));
                  seen.add(e.name);
                  genomes.push({ name: e.name, description: gj.description, source });
                } catch {}
              }
            } catch {}
          };

          await scanDir(GENOMES_DIR, 'installed');
          await scanDir(BUNDLED_GENOMES_DIR, 'bundled');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(genomes));
        } catch (err) {
          sendJsonErrorResponse(res, err, 500);
        }
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
          const genome = (body.genome || 'dreamer').trim();
          const model = (body.model || '').trim() || undefined;
          if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('invalid name (lowercase alphanumeric + hyphens)');
          const dir = path.join(CREATURES_DIR, name);
          try { await fs.access(dir); throw new Error(`creature "${name}" already exists`); } catch (e: any) { if (e.message.includes('already exists')) throw e; }

          // Return 202 immediately; spawn runs in background
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, name, status: 'spawning' }));

          this.pendingOps.add(name);
          await this.emitEvent(name, { type: 'creature.spawning', t: new Date().toISOString() } as any);
          this.spawnCreature(name, dir, purpose, genome, model).then(async () => {
            console.log(`[orchestrator] creature "${name}" ready`);
            await this.emitEvent(name, { type: 'creature.spawned', t: new Date().toISOString() } as any);
          }).catch(async (err) => {
            console.error(`[orchestrator] spawn failed for "${name}":`, err);
            await this.emitEvent(name, { type: 'creature.spawn_failed', t: new Date().toISOString(), error: err.message } as any);
          }).finally(() => {
            this.pendingOps.delete(name);
          });
        } catch (err) { sendErrorResponse(res, err); }
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
          } catch (err) { sendErrorResponse(res, err); }
          return;
        }

        if (action === 'stop' && req.method === 'POST') {
          try {
            await this.stopCreature(name);
            res.writeHead(200); res.end('ok');
          } catch (err) { sendErrorResponse(res, err); }
          return;
        }

        if (action === 'restart' && req.method === 'POST') {
          try {
            await this.restartCreature(name);
            res.writeHead(200); res.end('ok');
          } catch (err) { sendErrorResponse(res, err); }
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
          } catch (err) { sendErrorResponse(res, err); }
          return;
        }

        if (action === 'wake' && req.method === 'POST') {
          try {
            const supervisor = this.supervisors.get(name);
            if (!supervisor) throw new Error(`creature "${name}" is not running`);
            const body = await readBody(req);
            const reason = body ? (JSON.parse(body).reason || 'Woken manually') : 'Woken manually';
            const res2 = await fetch(creatureUrl(name, supervisor.port, '/wake'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason }),
            });
            if (!res2.ok) throw new Error('creature rejected wake');
            await this.emitEvent(name, { t: new Date().toISOString(), type: 'creature.wake', reason, source: 'manual' });
            console.log(`[${name}] force wake triggered: ${reason}`);
            res.writeHead(200); res.end('ok');
          } catch (err) { sendErrorResponse(res, err); }
          return;
        }

        if (action === 'message' && req.method === 'POST') {
          try {
            const body = await readBody(req);
            const { text } = JSON.parse(body);
            await this.sendMessage(name, text);
            // Always attempt to wake. forceWake() is a no-op if not sleeping,
            // and supervisor may lose sleeping status on orchestrator restart
            const sup = this.supervisors.get(name);
            if (sup?.port) {
              const reason = `Message from user: ${text.slice(0, 100)}`;
              try {
                const wakeRes = await fetch(creatureUrl(name, sup.port, '/wake'), {
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
          } catch (err) { sendErrorResponse(res, err); }
          return;
        }

        if (action === 'archive' && req.method === 'POST') {
          try {
            await this.archiveCreature(name);
            res.writeHead(200); res.end('ok');
          } catch (err) { sendErrorResponse(res, err); }
          return;
        }

        if (action === 'budget' && req.method === 'GET') {
          const cap = getSpendingCap(name);
          const dailySpent = this.costs.getCreatureDailyCost(name);
          const remaining = Math.max(0, cap.daily_usd - dailySpent);
          const now = new Date();
          const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            daily_cap_usd: cap.daily_usd,
            daily_spent_usd: Math.round(dailySpent * 100) / 100,
            remaining_usd: Math.round(remaining * 100) / 100,
            resets_at: tomorrow.toISOString(),
            action: cap.action,
            status: dailySpent >= cap.daily_usd ? 'exceeded' : 'ok',
          }));
          return;
        }

        if (action === 'budget' && req.method === 'PUT') {
          try {
            const body = await new Promise<string>((resolve) => {
              let data = ''; req.on('data', (c) => data += c); req.on('end', () => resolve(data));
            });
            const update = JSON.parse(body);
            const patch: Record<string, any> = {};
            if (typeof update.daily_usd === 'number' && update.daily_usd >= 0) patch.daily_usd = update.daily_usd;
            if (['sleep', 'warn', 'off'].includes(update.action)) patch.action = update.action;
            if (Object.keys(patch).length === 0) { res.writeHead(400); res.end('nothing to update'); return; }
            saveCreatureSpendingCap(name, patch);
            const cap = getSpendingCap(name);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ daily_usd: cap.daily_usd, action: cap.action }));
          } catch (err) { sendErrorResponse(res, err); }
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

          let tabs: Array<{ id: string; label: string; file: string; type: string; limit?: number }> = [];
          try {
            const genome = JSON.parse(await fs.readFile(path.join(dir, 'genome.json'), 'utf-8'));
            if (Array.isArray(genome.tabs)) tabs = genome.tabs;
          } catch {}

          const data: Record<string, unknown> = {};
          for (const tab of tabs) {
            if (tab.type === 'jsonl') {
              data[tab.id] = await readJsonl(tab.file, tab.limit || 10);
            } else {
              data[tab.id] = await read(tab.file);
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ tabs, data }));
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
