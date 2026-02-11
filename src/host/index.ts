import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn, ChildProcess } from "node:child_process";
import { EventStore, createSSEStream } from "./events.js";
import { getCurrentSHA, getLastGoodSHA, setLastGoodSHA, resetToSHA } from "./git.js";
import { Event, HostStatus } from "../shared/types.js";

const HEALTH_GATE_MS = 10000;
const ROLLBACK_TIMEOUT_MS = 30000;

export interface HostConfig {
  creatureDir: string;
  creatureName: string;
  hostPort: number;
  creaturePort: number;
  autoIterate: boolean;
}

export class Host {
  private config: HostConfig;
  private store: EventStore;
  private creature: ChildProcess | null = null;
  private currentSHA = "";
  private lastGoodSHA = "";
  private healthyAt: number | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private rollbackTimeout: NodeJS.Timeout | null = null;
  private expectingExit = false;

  constructor(config: HostConfig) {
    this.config = config;
    this.store = new EventStore(config.creatureDir);
  }

  async start() {
    await this.store.init();
    this.currentSHA = getCurrentSHA(this.config.creatureDir);
    this.lastGoodSHA = await getLastGoodSHA(this.config.creatureDir);

    await this.writeRunFile();
    this.setupCleanup();

    await this.emit({ t: new Date().toISOString(), type: "host.boot" });

    console.log(`[host] creature: ${this.config.creatureName} (${this.config.creatureDir})`);
    this.createServer();
    await this.spawnCreature();
  }

  private async writeRunFile() {
    const runFile = path.join(this.config.creatureDir, ".self", "run.json");
    await fs.mkdir(path.dirname(runFile), { recursive: true });
    await fs.writeFile(
      runFile,
      JSON.stringify(
        {
          host_port: this.config.hostPort,
          creature_port: this.config.creaturePort,
          host_pid: process.pid,
          creature_name: this.config.creatureName,
          started_at: new Date().toISOString(),
        },
        null,
        2
      ) + "\n",
      "utf-8"
    );
  }

  private async cleanupRunFile() {
    const runFile = path.join(this.config.creatureDir, ".self", "run.json");
    try {
      await fs.unlink(runFile);
    } catch {
      // Already gone
    }
  }

  private setupCleanup() {
    const cleanup = async () => {
      if (this.creature) this.creature.kill();
      await this.cleanupRunFile();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }

  private async emit(event: Event) {
    await this.store.emit(event);
    console.log(`[host] ${event.type}`, event);
  }

  private createServer() {
    const { hostPort } = this.config;

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${hostPort}`);

      if (url.pathname === "/" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(await this.renderUI());
        return;
      }

      if (url.pathname === "/events" && req.method === "GET") {
        createSSEStream(this.store)(req, res);
        return;
      }

      if (url.pathname === "/event" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk: string) => (body += chunk));
        req.on("end", async () => {
          try {
            const event = JSON.parse(body) as Event;
            await this.emit(event);
            res.writeHead(200);
            res.end("ok");
          } catch {
            res.writeHead(400);
            res.end("invalid event");
          }
        });
        return;
      }

      if (url.pathname === "/restart" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk: string) => (body += chunk));
        req.on("end", async () => {
          try {
            const { sha } = JSON.parse(body);
            await this.restartCreature(sha);
            res.writeHead(200);
            res.end("ok");
          } catch {
            res.writeHead(500);
            res.end("restart failed");
          }
        });
        return;
      }

      if (url.pathname === "/status" && req.method === "GET") {
        const status: HostStatus = {
          current_sha: this.currentSHA,
          last_good_sha: this.lastGoodSHA,
          pid: this.creature?.pid ?? null,
          healthy: this.healthyAt !== null,
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(status));
        return;
      }

      res.writeHead(404);
      res.end("not found");
    });

    server.listen(hostPort, () => {
      console.log(`[host] listening on http://localhost:${hostPort}`);
    });
  }

  private async spawnCreature() {
    const { creatureDir, creaturePort, hostPort, autoIterate } = this.config;

    this.currentSHA = getCurrentSHA(creatureDir);

    // Run the creature's own entry point from its own directory using its own tsx
    this.creature = spawn("npx", ["tsx", "src/index.ts"], {
      cwd: creatureDir,
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(creaturePort),
        HOST_URL: `http://127.0.0.1:${hostPort}`,
        AUTO_ITERATE: autoIterate ? "true" : "false",
      },
    });

    await this.emit({
      t: new Date().toISOString(),
      type: "host.spawn",
      pid: this.creature.pid!,
      sha: this.currentSHA,
    });

    this.creature.on("exit", (code) => {
      console.log(`[host] creature exited with code ${code}`);
      if (!this.expectingExit && code !== 0 && code !== null) {
        this.handleCreatureFailure("crash");
      }
      this.expectingExit = false;
    });

    this.startHealthCheck();
    this.startRollbackTimer();
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
        this.handleCreatureFailure("health timeout");
      }
    }, ROLLBACK_TIMEOUT_MS);
  }

  private async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.config.creaturePort}/healthz`);
      return res.ok;
    } catch {
      return false;
    }
  }

  private async promote() {
    if (this.rollbackTimeout) clearTimeout(this.rollbackTimeout);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);

    this.lastGoodSHA = this.currentSHA;
    await setLastGoodSHA(this.config.creatureDir, this.lastGoodSHA);

    await this.emit({
      t: new Date().toISOString(),
      type: "host.promote",
      sha: this.lastGoodSHA,
    });

    console.log(`[host] promoted ${this.lastGoodSHA.slice(0, 7)}`);
  }

  private async handleCreatureFailure(reason: string) {
    console.log(`[host] rollback triggered: ${reason}`);

    const from = this.currentSHA;
    const to = this.lastGoodSHA;

    if (this.creature) this.creature.kill();
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.rollbackTimeout) clearTimeout(this.rollbackTimeout);

    await this.emit({
      t: new Date().toISOString(),
      type: "host.rollback",
      from,
      to,
      reason,
    });

    resetToSHA(this.config.creatureDir, to);
    await this.spawnCreature();
  }

  private async restartCreature(_sha: string) {
    console.log(`[host] restart requested`);

    this.expectingExit = true;
    if (this.creature) this.creature.kill();
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.rollbackTimeout) clearTimeout(this.rollbackTimeout);

    this.healthyAt = null;
    await this.spawnCreature();
  }

  private async renderUI(): Promise<string> {
    const name = this.config.creatureName;
    return `<!DOCTYPE html>
<html>
<head>
  <title>itsalive — ${name}</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #111; color: #0f0; }
    .status { margin-bottom: 20px; padding: 10px; border: 1px solid #0f0; }
    .events { height: 400px; overflow-y: auto; border: 1px solid #0f0; padding: 10px; }
    .event { margin: 5px 0; }
    .event-type { color: #ff0; }
    h1 { color: #0f0; }
  </style>
</head>
<body>
  <h1>itsalive — ${name}</h1>
  <div class="status">
    <div>current: <span id="current">-</span></div>
    <div>last_good: <span id="last_good">-</span></div>
    <div>pid: <span id="pid">-</span></div>
    <div>healthy: <span id="healthy">-</span></div>
  </div>
  <div class="events" id="events"></div>
  <script>
    const events = document.getElementById('events');
    const sse = new EventSource('/events');

    sse.onmessage = (e) => {
      const event = JSON.parse(e.data);
      const div = document.createElement('div');
      div.className = 'event';
      div.innerHTML = \`<span class="event-type">\${event.type}</span> \${JSON.stringify(event)}\`;
      events.appendChild(div);
      events.scrollTop = events.scrollHeight;
    };

    setInterval(async () => {
      const res = await fetch('/status');
      const status = await res.json();
      document.getElementById('current').textContent = status.current_sha.slice(0, 7);
      document.getElementById('last_good').textContent = status.last_good_sha.slice(0, 7);
      document.getElementById('pid').textContent = status.pid || 'none';
      document.getElementById('healthy').textContent = status.healthy ? 'yes' : 'no';
    }, 1000);
  </script>
</body>
</html>`;
  }
}

// Direct invocation: parse config from env vars (used by CLI start command)
if (process.env.CREATURE_DIR) {
  const config: HostConfig = {
    creatureDir: process.env.CREATURE_DIR,
    creatureName: process.env.CREATURE_NAME || path.basename(process.env.CREATURE_DIR),
    hostPort: parseInt(process.env.HOST_PORT || "7777"),
    creaturePort: parseInt(process.env.CREATURE_PORT || "7778"),
    autoIterate: process.env.AUTO_ITERATE !== "false",
  };

  const host = new Host(config);
  host.start();
}
