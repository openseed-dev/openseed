import {
  ChildProcess,
  execSync,
  spawn,
} from 'node:child_process';
import fsSync from 'node:fs';
import path from 'node:path';

import { Event } from '../shared/types.js';
import {
  getCurrentSHA,
  getLastGoodSHA,
  resetToSHA,
  setLastGoodSHA,
} from './git.js';

const HEALTH_GATE_MS = 10_000;
const ROLLBACK_TIMEOUT_MS = 30_000;
const ITSALIVE_HOME = process.env.ITSALIVE_HOME || path.join(process.env.HOME || '/tmp', '.itsalive');
const ROLLBACK_DIR = path.join(ITSALIVE_HOME, 'rollbacks');
const MAX_LOG_LINES = 50;
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_FAILURE_BACKOFF_MS = 30_000;

const IS_DOCKER = process.env.ITSALIVE_DOCKER === '1';
const HOST_PATH = process.env.ITSALIVE_HOST_PATH || ITSALIVE_HOME;

export type CreatureStatus = 'stopped' | 'starting' | 'running' | 'sleeping' | 'error';

export interface SupervisorConfig {
  name: string;
  dir: string;
  port: number;
  orchestratorPort: number;
  autoIterate: boolean;
  model?: string;
}

export class CreatureSupervisor {
  readonly name: string;
  readonly dir: string;
  readonly port: number;
  status: CreatureStatus = 'stopped';

  private creature: ChildProcess | null = null;
  private currentSHA = '';
  private lastGoodSHA = '';
  private healthyAt: number | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private rollbackTimeout: NodeJS.Timeout | null = null;
  private expectingExit = false;
  private consecutiveFailures = 0;
  private config: SupervisorConfig;
  private onEvent: (name: string, event: Event) => Promise<void>;
  private recentOutput: string[] = [];

  constructor(
    config: SupervisorConfig,
    onEvent: (name: string, event: Event) => Promise<void>,
  ) {
    this.name = config.name;
    this.dir = config.dir;
    this.port = config.port;
    this.config = config;
    this.onEvent = onEvent;
  }

  async start(): Promise<void> {
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
    this.creature = null;
  }

  async restart(): Promise<void> {
    this.expectingExit = true;
    this.clearTimers();
    this.healthyAt = null;
    this.currentSHA = getCurrentSHA(this.dir);

    console.log(`[${this.name}] restarting container (environment preserved)`);
    try {
      execSync(`docker restart ${this.containerName()}`, { stdio: 'ignore', timeout: 30_000 });
    } catch {
      console.log(`[${this.name}] restart failed, spawning fresh`);
    }

    this.creature = null;
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
    if (event.type === 'creature.sleep') this.status = 'sleeping';
    else if (event.type === 'creature.error') this.status = 'error';
    else if (event.type === 'creature.tool_call' || event.type === 'creature.thought') {
      if (this.status === 'sleeping' || this.status === 'error') this.status = 'running';
    }
  }

  getInfo() {
    return {
      name: this.name,
      status: this.status,
      sha: this.currentSHA || null,
      last_good_sha: this.lastGoodSHA || null,
      healthy: this.healthyAt !== null,
      port: this.port,
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

  private destroyContainer() {
    try { execSync(`docker kill ${this.containerName()}`, { stdio: 'ignore' }); } catch {}
    try { execSync(`docker wait ${this.containerName()}`, { stdio: 'ignore', timeout: 5000 }); } catch {}
    try { execSync(`docker rm -f ${this.containerName()}`, { stdio: 'ignore' }); } catch {}
  }

  private createContainer(
    cname: string, dir: string, port: number,
    orchestratorPort: number, autoIterate: boolean, name: string,
  ): ChildProcess {
    console.log(`[${name}] creating new container`);

    // When the orchestrator runs in Docker, creature bind mounts must use the
    // real host path (docker socket operates on the host, not inside our container).
    const hostDir = IS_DOCKER
      ? dir.replace(process.env.ITSALIVE_HOME || '/data', HOST_PATH)
      : dir;

    const orchestratorUrl = IS_DOCKER
      ? `http://itsalive:${orchestratorPort}`
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
      '-e', 'PORT=7778',
      '-e', `AUTO_ITERATE=${autoIterate ? 'true' : 'false'}`,
      ...(this.config.model ? ['-e', `LLM_MODEL=${this.config.model}`] : []),
      ...(IS_DOCKER ? ['--network', 'itsalive'] : []),
      `creature-${name}`,
    ];

    return spawn('docker', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  private async spawnCreature() {
    const { dir, port, orchestratorPort, autoIterate, name } = this.config;
    this.currentSHA = getCurrentSHA(dir);

    let reconnected = false;
    const cname = this.containerName();

    if (this.isContainerRunning()) {
      console.log(`[${name}] reconnecting to running container`);
      this.creature = spawn('docker', ['logs', '-f', '--tail', '50', cname], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      reconnected = true;
    } else if (this.containerExists()) {
      console.log(`[${name}] starting existing container (environment preserved)`);
      try {
        execSync(`docker start ${cname}`, { stdio: 'ignore', timeout: 15_000 });
        this.creature = spawn('docker', ['logs', '-f', '--tail', '50', cname], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        reconnected = true;
      } catch {
        console.log(`[${name}] start failed, creating fresh container`);
        try { execSync(`docker rm -f ${cname}`, { stdio: 'ignore' }); } catch {}
        this.creature = this.createContainer(cname, dir, port, orchestratorPort, autoIterate, name);
      }
    } else {
      this.creature = this.createContainer(cname, dir, port, orchestratorPort, autoIterate, name);
    }

    this.recentOutput = [];
    this.creature.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        console.log(`[${name}] ${line}`);
        this.recentOutput.push(line);
        if (this.recentOutput.length > MAX_LOG_LINES) this.recentOutput.shift();
      }
    });
    this.creature.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        console.error(`[${name}] ${line}`);
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
      console.log(`[${name}] process exited with code ${code}`);
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
    if (this.rollbackTimeout) clearTimeout(this.rollbackTimeout);
    this.rollbackTimeout = setTimeout(() => {
      if (!this.healthyAt) {
        this.handleCreatureFailure('health timeout');
      }
    }, ROLLBACK_TIMEOUT_MS);
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

    // Guard A: if Docker is down, don't rollback or retry — infrastructure is the problem
    if (!this.isDockerAvailable()) {
      console.log(`[${this.name}] Docker unavailable — stopping (not rolling back)`);
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

    // Guard C: max consecutive failures — stop trying
    if (this.consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
      console.log(`[${this.name}] ${this.consecutiveFailures} consecutive failures — giving up`);
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
        this.destroyContainer();
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
