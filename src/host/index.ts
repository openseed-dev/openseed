import http from "node:http";
import { spawn, ChildProcess } from "node:child_process";
import { EventStore, createSSEStream } from "./events.js";
import { getCurrentSHA, getLastGoodSHA, setLastGoodSHA, resetToSHA } from "./git.js";
import { Event, HostStatus } from "../shared/types.js";
import fs from "node:fs/promises";

const HOST_PORT = 7777;
const CREATURE_PORT = 7778;
const HEALTH_GATE_MS = 10000; // 10s
const ROLLBACK_TIMEOUT_MS = 30000; // 30s

class Host {
  private store = new EventStore();
  private creature: ChildProcess | null = null;
  private currentSHA = "";
  private lastGoodSHA = "";
  private healthyAt: number | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private rollbackTimeout: NodeJS.Timeout | null = null;
  private expectingExit = false;

  async start() {
    await this.store.init();
    this.currentSHA = getCurrentSHA();
    this.lastGoodSHA = await getLastGoodSHA();

    await this.emit({ t: new Date().toISOString(), type: "host.boot" });

    this.createServer();
    await this.spawnCreature();
  }

  private async emit(event: Event) {
    await this.store.emit(event);
    console.log(`[host] ${event.type}`, event);
  }

  private createServer() {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${HOST_PORT}`);

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
        req.on("data", chunk => (body += chunk));
        req.on("end", async () => {
          try {
            const event = JSON.parse(body) as Event;
            await this.emit(event);
            res.writeHead(200);
            res.end("ok");
          } catch (err) {
            res.writeHead(400);
            res.end("invalid event");
          }
        });
        return;
      }

      if (url.pathname === "/restart" && req.method === "POST") {
        let body = "";
        req.on("data", chunk => (body += chunk));
        req.on("end", async () => {
          try {
            const { sha } = JSON.parse(body);
            await this.restartCreature(sha);
            res.writeHead(200);
            res.end("ok");
          } catch (err) {
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

    server.listen(HOST_PORT, () => {
      console.log(`[host] listening on http://localhost:${HOST_PORT}`);
    });
  }

  private async spawnCreature() {
    this.currentSHA = getCurrentSHA();

    this.creature = spawn("tsx", ["src/creature/index.ts"], {
      stdio: "inherit",
      env: { ...process.env, PORT: String(CREATURE_PORT) },
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
      const res = await fetch(`http://127.0.0.1:${CREATURE_PORT}/healthz`);
      return res.ok;
    } catch {
      return false;
    }
  }

  private async promote() {
    if (this.rollbackTimeout) clearTimeout(this.rollbackTimeout);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);

    this.lastGoodSHA = this.currentSHA;
    await setLastGoodSHA(this.lastGoodSHA);

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

    resetToSHA(to);
    await this.spawnCreature();
  }

  private async restartCreature(sha: string) {
    console.log(`[host] restart requested for ${sha.slice(0, 7)}`);

    this.expectingExit = true;
    if (this.creature) this.creature.kill();
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.rollbackTimeout) clearTimeout(this.rollbackTimeout);

    this.healthyAt = null;
    await this.spawnCreature();
  }

  private async renderUI(): Promise<string> {
    return `<!DOCTYPE html>
<html>
<head>
  <title>itsalive</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #111; color: #0f0; }
    .status { margin-bottom: 20px; padding: 10px; border: 1px solid #0f0; }
    .events { height: 400px; overflow-y: auto; border: 1px solid #0f0; padding: 10px; }
    .event { margin: 5px 0; }
    .event-type { color: #ff0; }
  </style>
</head>
<body>
  <h1>itsalive</h1>
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

const host = new Host();
host.start();
