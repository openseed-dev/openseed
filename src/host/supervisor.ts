import {
  ChildProcess,
  execSync,
  spawn,
} from 'node:child_process';

import { Event } from '../shared/types.js';
import {
  getCurrentSHA,
  getLastGoodSHA,
  resetToSHA,
  setLastGoodSHA,
} from './git.js';

const HEALTH_GATE_MS = 10_000;
const ROLLBACK_TIMEOUT_MS = 30_000;

export type CreatureStatus = 'stopped' | 'starting' | 'running' | 'sleeping';

export interface SupervisorConfig {
  name: string;
  dir: string;
  port: number;
  orchestratorPort: number;
  autoIterate: boolean;
  sandboxed: boolean;
}

export class CreatureSupervisor {
  readonly name: string;
  readonly dir: string;
  readonly port: number;
  readonly sandboxed: boolean;
  status: CreatureStatus = 'stopped';

  private creature: ChildProcess | null = null;
  private currentSHA = '';
  private lastGoodSHA = '';
  private healthyAt: number | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private rollbackTimeout: NodeJS.Timeout | null = null;
  private expectingExit = false;
  private config: SupervisorConfig;
  private onEvent: (name: string, event: Event) => Promise<void>;

  constructor(
    config: SupervisorConfig,
    onEvent: (name: string, event: Event) => Promise<void>,
  ) {
    this.name = config.name;
    this.dir = config.dir;
    this.port = config.port;
    this.sandboxed = config.sandboxed;
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
    this.killCreature();
    this.clearTimers();
    this.status = 'stopped';
    this.creature = null;
  }

  async restart(): Promise<void> {
    this.expectingExit = true;
    this.killCreature();
    this.clearTimers();
    this.healthyAt = null;
    this.creature = null;
    this.status = 'starting';
    await this.spawnCreature();
  }

  updateFromEvent(event: Event) {
    if (this.status === 'stopped') return;
    if (event.type === 'creature.sleep') this.status = 'sleeping';
    else if (event.type === 'creature.tool_call' && this.status === 'sleeping') this.status = 'running';
  }

  getInfo() {
    return {
      name: this.name,
      status: this.status,
      sha: this.currentSHA || null,
      last_good_sha: this.lastGoodSHA || null,
      healthy: this.healthyAt !== null,
      port: this.port,
      sandboxed: this.sandboxed,
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

  private killCreature() {
    if (this.config.sandboxed) {
      try { execSync(`docker kill ${this.containerName()}`, { stdio: 'ignore' }); } catch {}
      // Wait for container to die, then force remove
      try { execSync(`docker wait ${this.containerName()}`, { stdio: 'ignore', timeout: 5000 }); } catch {}
      try { execSync(`docker rm -f ${this.containerName()}`, { stdio: 'ignore' }); } catch {}
    } else if (this.creature) {
      this.creature.kill();
    }
  }

  private async spawnCreature() {
    const { dir, port, orchestratorPort, autoIterate, sandboxed, name } = this.config;
    this.currentSHA = getCurrentSHA(dir);

    let reconnected = false;

    if (sandboxed) {
      const cname = this.containerName();

      if (this.isContainerRunning()) {
        console.log(`[${name}] reconnecting to running container`);
        this.creature = spawn('docker', ['logs', '-f', '--tail', '50', cname], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        reconnected = true;
      } else {
        try { execSync(`docker rm -f ${cname}`, { stdio: 'ignore' }); } catch {}

        this.creature = spawn('docker', [
          'run', '--rm', '--init',
          '--name', cname,
          '--memory', '2g',
          '--cpus', '1.5',
          '-p', `${port}:7778`,
          '-v', `${dir}:/creature`,
          '-v', `${cname}-node-modules:/creature/node_modules`,
          '-e', `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY || ''}`,
          '-e', `HOST_URL=http://host.docker.internal:${orchestratorPort}`,
          '-e', `CREATURE_NAME=${name}`,
          '-e', 'PORT=7778',
          '-e', `AUTO_ITERATE=${autoIterate ? 'true' : 'false'}`,
          `creature-${name}`,
        ], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        console.log(`[${name}] spawned container`);
      }
    } else {
      this.creature = spawn('npx', ['tsx', 'src/index.ts'], {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PORT: String(port),
          HOST_URL: `http://127.0.0.1:${orchestratorPort}`,
          CREATURE_NAME: name,
          AUTO_ITERATE: autoIterate ? 'true' : 'false',
        },
      });
    }

    this.creature.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        console.log(`[${name}] ${line}`);
      }
    });
    this.creature.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        console.error(`[${name}] ${line}`);
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
      const res = await fetch(`http://127.0.0.1:${this.port}/healthz`);
      return res.ok;
    } catch {
      return false;
    }
  }

  private async promote() {
    this.clearTimers();
    this.lastGoodSHA = this.currentSHA;
    await setLastGoodSHA(this.dir, this.lastGoodSHA);
    if (this.status === 'starting') this.status = 'running';

    await this.emit({
      t: new Date().toISOString(),
      type: 'host.promote',
      sha: this.lastGoodSHA,
    });

    console.log(`[${this.name}] promoted ${this.lastGoodSHA.slice(0, 7)}`);
  }

  private async handleCreatureFailure(reason: string) {
    console.log(`[${this.name}] rollback: ${reason}`);
    const from = this.currentSHA;
    const to = this.lastGoodSHA;

    this.killCreature();
    this.clearTimers();

    await this.emit({
      t: new Date().toISOString(),
      type: 'host.rollback',
      from,
      to,
      reason,
    });

    resetToSHA(this.dir, to);
    this.status = 'starting';
    await this.spawnCreature();
  }
}
