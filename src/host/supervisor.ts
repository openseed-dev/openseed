import {
  ChildProcess,
  execSync,
  spawn,
} from 'node:child_process';
import fsSync from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { deriveCreatureToken, evictCreatureTokenCache } from './creature-auth.js';
import { Event } from '../shared/types.js';
import {
  getCurrentSHA,
  getLastGoodSHA,
  resetToSHA,
  setLastGoodSHA,
} from './git.js';
import {
  getJaneeAuthorityUrl,
  getJaneeRunnerKey,
} from './janee.js';

const HEALTH_GATE_MS = 10_000;
const ROLLBACK_TIMEOUT_MS = 60_000;
const OPENSEED_HOME = process.env.OPENSEED_HOME || process.env.ITSALIVE_HOME || path.join(process.env.HOME || '/tmp', '.openseed');
const ROLLBACK_DIR = path.join(OPENSEED_HOME, 'rollbacks');
const MAX_LOG_LINES = 50;
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_FAILURE_BACKOFF_MS = 30_000;

const IS_DOCKER = process.env.OPENSEED_DOCKER === '1' || process.env.ITSALIVE_DOCKER === '1';
const HOST_PATH = process.env.OPENSEED_HOST_PATH || process.env.ITSALIVE_HOST_PATH || OPENSEED_HOME;

/** Rewrite an internal container path to the host path for Docker bind mounts. */
function toHostPath(p: string): string {
  if (!IS_DOCKER) return p;
  const result = p.replace(OPENSEED_HOME, HOST_PATH);
  if (result === p) {
    console.warn(`[supervisor] WARNING: path substitution did not change "${p}" — bind mount may fail`);
  }
  return result;
}

export type CreatureStatus = 'stopped' | 'starting' | 'running' | 'sleeping' | 'error';

export interface SupervisorConfig {
  name: string;
  dir: string;
  port: number;
  orchestratorPort: number;
  autoIterate: boolean;
  model?: string;
}

export type SleepReason = 'budget' | 'fatigue' | 'user' | null;

export class CreatureSupervisor {
  readonly name: string;
  readonly dir: string;
  port: number;
  status: CreatureStatus = 'stopped';
  sleepReason: SleepReason = null;
  janeeVersion: string | null = null;

  private creature: ChildProcess | null = null;
  private currentSHA = '';
  private lastGoodSHA = '';
  private healthyAt: number | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private rollbackTimeout: NodeJS.Timeout | null = null;
  private lastOutputAt: number = 0;
  private expectingExit = false;
  private consecutiveFailures = 0;
  private config: SupervisorConfig;
  private onEvent: (name: string, event: Event) => Promise<void>;
  private recentOutput: string[] = [];

  private onReallocatePort: (() => Promise<number>) | null = null;

  constructor(
    config: SupervisorConfig,
    onEvent: (name: string, event: Event) => Promise<void>,
    opts?: { onReallocatePort?: () => Promise<number> },
  ) {
    this.name = config.name;
    this.dir = config.dir;
    this.port = config.port;
    this.config = config;
    this.onEvent = onEvent;
    this.onReallocatePort = opts?.onReallocatePort ?? null;
  }

  async start(): Promise<void> {
    this.sleepReason = null;
    this.currentSHA = getCurrentSHA(this.dir);
    this.lastGoodSHA = await getLastGoodSHA(this.dir);
    this.status = 'starting';
    await this.spawnCreature();
  }

  async stop(): Promise<void> {
    this.expectingExit = true;
    this.clearTimers();
    try { execSync(`docker stop ${this.containerName()}`, { stdio: 'ignore', timeout: 15_000 }); } catch {}
    this.status = 'stopped';
    evictCreatureTokenCache(this.name);
    this.sleepReason = 'user';
    this.creature = null;
  }

  async budgetPause(): Promise<void> {
    this.expectingExit = true;
    this.clearTimers();
    try { execSync(`docker stop ${this.containerName()}`, { stdio: 'ignore', timeout: 15_000 }); } catch {}
    this.status = 'sleeping';
    this.sleepReason = 'budget';
    this.creature = null;
  }

  async restart(): Promise<void> {
    this.expectingExit = true;
    this.clearTimers();
    this.healthyAt = null;
    const wasSleeping = this.status === 'sleeping';
    this.currentSHA = getCurrentSHA(this.dir);

    console.log(`[${this.name}] restarting container (environment preserved)`);
    try {
      execSync(`docker restart ${this.containerName()}`, { stdio: 'ignore', timeout: 30_000 });
    } catch {
      console.log(`[${this.name}] restart failed, spawning fresh`);
    }

    this.creature = null;
    this.status = wasSleeping ? 'sleeping' : 'starting';
    await this.spawnCreature();
  }
  // Recreate container preserving its writable layer (installed packages,
  // configs, etc.). Commits the container state into the image, removes the old
  // container, then creates a fresh one from the updated image — picking up any
  // new mounts, env vars, or network config. Running processes stop but their
  // installed artifacts survive.
  async remount(): Promise<void> {
    this.expectingExit = true;
    this.clearTimers();
    this.healthyAt = null;
    const cname = this.containerName();

    console.log(`[${this.name}] remounting: committing container state to image`);
    try { execSync(`docker stop ${cname}`, { stdio: 'ignore', timeout: 15_000 }); } catch {}
    try {
      execSync(`docker commit ${cname} ${cname}`, { stdio: 'ignore', timeout: 120_000 });
    } catch (err) {
      console.error(`[${this.name}] remount: commit failed — container preserved, aborting`, err);
      this.expectingExit = false;
      throw err;
    }
    try { execSync(`docker rm -f ${cname}`, { stdio: 'ignore' }); } catch {}

    this.creature = null;
    this.currentSHA = getCurrentSHA(this.dir);
    this.status = 'starting';
    await this.spawnCreature();
  }


  // Full rebuild: destroys container (writable layer lost). Developer-only.
  async rebuild(): Promise<void> {
    this.expectingExit = true;
    this.clearTimers();
    this.healthyAt = null;
    this.destroyContainer();
    this.creature = null;
    this.currentSHA = getCurrentSHA(this.dir);
    this.status = 'starting';
    await this.spawnCreature();
  }

  updateFromEvent(event: Event) {
    if (this.status === 'stopped') return;
    if (event.type === 'creature.sleep') {
      this.status = 'sleeping';
      if (this.sleepReason !== 'budget') this.sleepReason = 'fatigue';
    } else if (event.type === 'creature.error') {
      this.status = 'error';
    } else if (event.type === 'creature.tool_call' || event.type === 'creature.thought') {
      if (this.status === 'sleeping' || this.status === 'error') {
        this.status = 'running';
        this.sleepReason = null;
      }
    }
  }

  setModel(model: string) { this.config = { ...this.config, model }; }

  getInfo() {
    return {
      name: this.name,
      status: this.status,
      sleepReason: this.sleepReason,
      sha: this.currentSHA || null,
      last_good_sha: this.lastGoodSHA || null,
      healthy: this.healthyAt !== null,
      port: this.port,
      model: this.config.model || null,
      janeeVersion: this.janeeVersion,
    };
  }

  isContainerRunning(): boolean {
    try {
      const out = execSync(
        `docker inspect -f '{{.State.Running}}' ${this.containerName()}`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      return out === 'true';
    } catch {
      return false;
    }
  }

  private containerExists(): boolean {
    try {
      execSync(
        `docker inspect ${this.containerName()}`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      return true;
    } catch {
      return false;
    }
  }

  private async emit(event: Event) {
    await this.onEvent(this.name, event);
  }

  private clearTimers() {
    if (this.healthCheckInterval) { clearInterval(this.healthCheckInterval); this.healthCheckInterval = null; }
    if (this.rollbackTimeout) { clearTimeout(this.rollbackTimeout); this.rollbackTimeout = null; }
  }

  private containerName(): string {
    return `creature-${this.name}`;
  }

  private getContainerEnv(cname: string, key: string): string {
    try {
      const out = execSync(
        `docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' ${cname}`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
      for (const line of out.split('\n')) {
        if (line.startsWith(key + '=')) return line.slice(key.length + 1);
      }
    } catch {}
    return '';
  }

  private destroyContainer() {
    try { execSync(`docker kill ${this.containerName()}`, { stdio: 'ignore' }); } catch {}
    try { execSync(`docker wait ${this.containerName()}`, { stdio: 'ignore', timeout: 5000 }); } catch {}
    try { execSync(`docker rm -f ${this.containerName()}`, { stdio: 'ignore' }); } catch {}
  }

  private isPortFree(port: number): Promise<boolean> {
    const check = (host: string): Promise<boolean> => new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => { server.close(() => resolve(true)); });
      server.listen(port, host);
    });
    return check('0.0.0.0').then(ok => ok ? check('::') : false);
  }

  private async ensurePort(): Promise<void> {
    const { port } = this.config;
    if (await this.isPortFree(port)) return;
    console.warn(`[${this.name}] port ${port} is not available`);
    const newPort = await this.remountWithNewPort();
    if (!newPort) throw new Error(`port ${port} unavailable and no reallocation callback`);
  }

  private async remountWithNewPort(): Promise<number | null> {
    if (!this.onReallocatePort) return null;
    const cname = this.containerName();
    try {
      execSync(`docker commit ${cname} ${cname}`, { stdio: 'ignore', timeout: 120_000 });
    } catch {
      // Can't commit (e.g. "Created" state) — nothing to preserve
    }
    try { execSync(`docker rm -f ${cname}`, { stdio: 'ignore' }); } catch {}
    const newPort = await this.onReallocatePort();
    this.port = newPort;
    this.config = { ...this.config, port: newPort };
    console.log(`[${this.name}] port reallocated to ${newPort}`);
    return newPort;
  }

  private createContainer(
    cname: string, dir: string, port: number,
    orchestratorPort: number, autoIterate: boolean, name: string,
  ): ChildProcess {
    console.log(`[${name}] creating new container`);

    // When the orchestrator runs in Docker, creature bind mounts must use the
    // real host path (docker socket operates on the host, not inside our container).
    const hostDir = toHostPath(dir);

    const orchestratorUrl = IS_DOCKER
      ? `http://openseed:${orchestratorPort}`
      : `http://host.docker.internal:${orchestratorPort}`;

    const args = [
      'run', '--init',
      '--name', cname,
      '--memory', '2g',
      '--cpus', '1.5',
      '-p', `${port}:7778`,
      '-v', `${hostDir}:/creature`,
      '-v', `${cname}-node-modules:/creature/node_modules`,
      '-e', `ANTHROPIC_API_KEY=creature:${name}`,
      '-e', `ANTHROPIC_BASE_URL=${orchestratorUrl}`,
      '-e', `HOST_URL=${orchestratorUrl}`,
      '-e', `CREATURE_NAME=${name}`,
      '-e', `CREATURE_TOKEN=${deriveCreatureToken(name)}`,
      '-e', 'PORT=7778',
      '-e', `AUTO_ITERATE=${autoIterate ? 'true' : 'false'}`,
      ...(this.config.model ? ['-e', `LLM_MODEL=${this.config.model}`] : []),
      ...(getJaneeAuthorityUrl() ? [
        '-e', 'JANEE_URL=http://localhost:3200',
        '-e', `JANEE_AUTHORITY_URL=${getJaneeAuthorityUrl()}`,
        '-e', `JANEE_RUNNER_KEY=${getJaneeRunnerKey()}`,
      ] : []),
      ...(IS_DOCKER ? ['--network', 'openseed'] : []),
      `creature-${name}`,
    ];

    return spawn('docker', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  private async spawnCreature() {
    this.currentSHA = getCurrentSHA(this.config.dir);

    let reconnected = false;
    const cname = this.containerName();

    if (this.isContainerRunning()) {
      console.log(`[${this.name}] reconnecting to running container`);
      this.creature = spawn('docker', ['logs', '-f', '--tail', '50', cname], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      reconnected = true;
    } else if (this.containerExists()) {
      const containerModel = this.getContainerEnv(cname, 'LLM_MODEL');
      const wantModel = this.config.model || '';
      if (containerModel !== wantModel) {
        console.log(`[${this.name}] config changed (model: ${containerModel || '(none)'} → ${wantModel || '(default)'}), remounting`);
        try {
          execSync(`docker commit ${cname} ${cname}`, { stdio: 'ignore', timeout: 120_000 });
        } catch (err) {
          console.error(`[${this.name}] commit failed before remount, container preserved`, err);
        }
        try { execSync(`docker rm -f ${cname}`, { stdio: 'ignore' }); } catch {}
        await this.ensurePort();
        const { dir, port, orchestratorPort, autoIterate, name } = this.config;
        this.creature = this.createContainer(cname, dir, port, orchestratorPort, autoIterate, name);
      } else {
        console.log(`[${this.name}] starting existing container (environment preserved)`);
        try {
          execSync(`docker start ${cname}`, { stdio: 'ignore', timeout: 15_000 });
          try {
            const portOut = execSync(`docker port ${cname} 7778`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
            const actualPort = parseInt(portOut.split(':').pop()!);
            if (!isNaN(actualPort) && actualPort !== this.port) {
              console.warn(`[${this.name}] port corrected: supervisor had ${this.port}, Docker has ${actualPort}`);
              this.port = actualPort;
              this.config = { ...this.config, port: actualPort };
            }
          } catch {}
          this.creature = spawn('docker', ['logs', '-f', '--tail', '50', cname], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          reconnected = true;
        } catch {
          console.log(`[${this.name}] start failed, remounting`);
          await this.remountWithNewPort();
          const { dir, port, orchestratorPort, autoIterate, name } = this.config;
          this.creature = this.createContainer(cname, dir, port, orchestratorPort, autoIterate, name);
        }
      }
    } else {
      await this.ensurePort();
      const { dir, port, orchestratorPort, autoIterate, name } = this.config;
      this.creature = this.createContainer(cname, dir, port, orchestratorPort, autoIterate, name);
    }

    this.recentOutput = [];
    this.creature.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        console.log(`[${this.name}] ${line}`);
        this.lastOutputAt = Date.now();
        this.recentOutput.push(line);
        if (this.recentOutput.length > MAX_LOG_LINES) this.recentOutput.shift();
      }
    });
    this.creature.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        console.error(`[${this.name}] ${line}`);
        this.lastOutputAt = Date.now();
        this.recentOutput.push(`STDERR: ${line}`);
        if (this.recentOutput.length > MAX_LOG_LINES) this.recentOutput.shift();
      }
    });

    if (!reconnected) {
      await this.emit({
        t: new Date().toISOString(),
        type: 'host.spawn',
        pid: this.creature.pid!,
        sha: this.currentSHA,
      });
    }

    this.creature.on('exit', (code) => {
      console.log(`[${this.name}] process exited with code ${code}`);
      if (!this.expectingExit) {
        if (reconnected && code === 0 && this.isContainerRunning()) return;
        this.handleCreatureFailure('crash');
      }
      this.expectingExit = false;
    });

    this.startHealthCheck();
    if (!reconnected) {
      this.startRollbackTimer();
    }
  }

  private startHealthCheck() {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    this.healthCheckInterval = setInterval(async () => {
      const healthy = await this.checkHealth();
      if (healthy && !this.healthyAt) {
        this.healthyAt = Date.now();
      } else if (!healthy) {
        this.healthyAt = null;
      }
      if (this.healthyAt && Date.now() - this.healthyAt >= HEALTH_GATE_MS) {
        await this.promote();
      }
    }, 1000);
  }

  private startRollbackTimer() {
    const hardDeadline = Date.now() + 5 * 60_000;
    this.lastOutputAt = Date.now();

    const check = () => {
      if (this.healthyAt) return;

      const now = Date.now();
      const idleMs = now - this.lastOutputAt;

      if (now >= hardDeadline) {
        this.handleCreatureFailure('health timeout (hard deadline)');
      } else if (idleMs >= ROLLBACK_TIMEOUT_MS) {
        this.handleCreatureFailure('health timeout (idle)');
      } else {
        this.rollbackTimeout = setTimeout(check, Math.min(ROLLBACK_TIMEOUT_MS - idleMs + 1000, hardDeadline - now));
      }
    };

    if (this.rollbackTimeout) clearTimeout(this.rollbackTimeout);
    this.rollbackTimeout = setTimeout(check, ROLLBACK_TIMEOUT_MS);
  }

  private async checkHealth(): Promise<boolean> {
    try {
      const host = IS_DOCKER ? this.containerName() : '127.0.0.1';
      const port = IS_DOCKER ? 7778 : this.port;
      const res = await fetch(`http://${host}:${port}/healthz`);
      return res.ok;
    } catch {
      return false;
    }
  }

  private async promote() {
    this.clearTimers();
    this.lastGoodSHA = this.currentSHA;
    this.consecutiveFailures = 0;
    await setLastGoodSHA(this.dir, this.lastGoodSHA);
    if (this.status === 'starting') this.status = 'running';

    await this.emit({
      t: new Date().toISOString(),
      type: 'host.promote',
      sha: this.lastGoodSHA,
    });

    console.log(`[${this.name}] promoted ${this.lastGoodSHA.slice(0, 7)}`);
  }

  private isDockerAvailable(): boolean {
    try { execSync('docker info', { stdio: 'ignore', timeout: 5_000 }); return true; } catch { return false; }
  }

  private async handleCreatureFailure(reason: string) {
    this.expectingExit = true;
    this.clearTimers();

    // Guard A: if Docker is down, don't rollback or retry. Infrastructure is the problem.
    if (!this.isDockerAvailable()) {
      console.log(`[${this.name}] Docker unavailable, stopping (not rolling back)`);
      this.status = 'stopped';
      this.creature = null;
      await this.emit({ t: new Date().toISOString(), type: 'host.infra_failure', reason: 'Docker unavailable' });
      return;
    }

    this.consecutiveFailures++;
    const from = this.currentSHA;
    const to = this.lastGoodSHA;
    const lastOutput = this.recentOutput.slice(-20).join('\n');

    // Guard B: skip rollback if code is already at last good SHA
    const needsRollback = from && to && from !== to;

    console.log(`[${this.name}] failure #${this.consecutiveFailures}: ${reason}${needsRollback ? ` (rolling back ${from.slice(0, 7)} → ${to.slice(0, 7)})` : ' (same SHA, skipping rollback)'}`);

    await this.emit({
      t: new Date().toISOString(),
      type: 'host.rollback',
      from,
      to,
      reason,
    });

    // Write rollback log to creature's .sys/ (accessible inside the container for self-evaluation)
    const entry = JSON.stringify({
      t: new Date().toISOString(),
      reason,
      from,
      to,
      lastOutput: lastOutput.slice(0, 1000),
    });
    try {
      const creatureSysDir = path.join(this.dir, '.sys');
      fsSync.mkdirSync(creatureSysDir, { recursive: true });
      fsSync.appendFileSync(path.join(creatureSysDir, 'rollbacks.jsonl'), entry + '\n');
    } catch {}
    try {
      fsSync.mkdirSync(ROLLBACK_DIR, { recursive: true });
      fsSync.appendFileSync(path.join(ROLLBACK_DIR, `${this.name}.jsonl`), entry + '\n');
    } catch {}

    // Guard C: max consecutive failures, stop trying
    if (this.consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
      console.log(`[${this.name}] ${this.consecutiveFailures} consecutive failures, giving up`);
      this.status = 'stopped';
      this.creature = null;
      return;
    }

    if (needsRollback) {
      resetToSHA(this.dir, to);
    }

    if (this.containerExists()) {
      try {
        execSync(`docker restart ${this.containerName()}`, { stdio: 'ignore', timeout: 30_000 });
      } catch {
        if (this.onReallocatePort) {
          await this.remountWithNewPort();
        } else {
          this.destroyContainer();
        }
      }
    }

    this.creature = null;
    this.status = 'starting';

    // Exponential backoff before retry
    const backoff = Math.min(1000 * Math.pow(2, this.consecutiveFailures - 1), MAX_FAILURE_BACKOFF_MS);
    console.log(`[${this.name}] retrying in ${backoff}ms`);
    await new Promise(r => setTimeout(r, backoff));

    await this.spawnCreature();
  }
}
