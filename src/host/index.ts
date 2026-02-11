import {
  ChildProcess,
  spawn,
} from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import {
  Event,
  HostStatus,
} from '../shared/types.js';
import {
  createSSEStream,
  EventStore,
} from './events.js';
import {
  getCurrentSHA,
  getLastGoodSHA,
  resetToSHA,
  setLastGoodSHA,
} from './git.js';

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
      stdio: ["ignore", "inherit", "inherit"],
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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; background: #0a0a0a; color: #ccc; padding: 24px; font-size: 13px; }
    h1 { color: #0f0; font-size: 18px; margin-bottom: 16px; }
    h1 span { color: #555; font-weight: normal; }
    .status { display: flex; gap: 24px; margin-bottom: 16px; padding: 12px 16px; background: #141414; border: 1px solid #222; border-radius: 6px; }
    .status div { color: #777; }
    .status span { color: #eee; }
    .status .healthy-yes { color: #0f0; }
    .status .healthy-no { color: #f55; }
    .events { height: calc(100vh - 140px); overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
    .event { padding: 6px 12px; border-radius: 4px; border-left: 3px solid #333; background: #111; }
    .event .time { color: #555; font-size: 11px; }
    .event .type { font-weight: bold; margin-left: 8px; }

    .event.host-boot { border-left-color: #666; }
    .event.host-spawn { border-left-color: #58f; }
    .event.host-promote { border-left-color: #0f0; }
    .event.host-rollback { border-left-color: #f33; background: #1a0808; }
    .event.creature-boot { border-left-color: #58f; }
    .event.creature-intent { border-left-color: #fa0; }
    .event.creature-tool-call { border-left-color: #0af; }
    .event.creature-tool-call.browser { border-left-color: #a6e; }
    .event.creature-tool-call.fail { border-left-color: #f55; }

    .event .type.host { color: #666; }
    .event .type.promote { color: #0f0; }
    .event .type.rollback { color: #f33; }
    .event .type.intent { color: #fa0; }
    .event .type.tool { color: #0af; }
    .event .type.tool.browser { color: #a6e; }
    .event .type.tool.fail { color: #f55; }
    .event .type.boot { color: #58f; }

    .intent-text { color: #eee; margin-left: 4px; white-space: pre-wrap; }
    .thought-summary { cursor: pointer; }
    .thought-summary:hover { text-decoration: underline; }
    .thought-body { display: none; margin-top: 6px; padding: 8px; background: #0d0d0d; border-radius: 4px; white-space: pre-wrap; word-break: break-word; color: #aaa; font-size: 12px; max-height: 300px; overflow-y: auto; }
    .thought-body.open { display: block; }
    .tool-cmd { color: #fff; background: #1a1a2a; padding: 2px 6px; border-radius: 3px; margin-left: 6px; }
    .tool-status { margin-left: 6px; font-size: 11px; }
    .tool-status.ok { color: #0f0; }
    .tool-status.err { color: #f55; }
    .tool-output { display: block; color: #888; margin-top: 4px; padding: 6px 8px; background: #0d0d0d; border-radius: 3px; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; font-size: 12px; }
    .tool-ms { color: #555; font-size: 11px; margin-left: 6px; }
    .sha { color: #58f; }
    .detail { color: #888; margin-left: 4px; }
  </style>
</head>
<body>
  <h1>itsalive <span>— ${name}</span></h1>
  <div class="status">
    <div>sha <span id="current">-</span></div>
    <div>last good <span id="last_good">-</span></div>
    <div>pid <span id="pid">-</span></div>
    <div>healthy <span id="healthy">-</span></div>
  </div>
  <div class="events" id="events"></div>
  <script>
    const eventsEl = document.getElementById('events');
    const sse = new EventSource('/events');

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function ts(t) { return t ? t.slice(11, 19) : ''; }
    function toggleThought(id) { document.getElementById(id)?.classList.toggle('open'); }
    function summarize(text, max) {
      if (!text) return '...';
      const line = text.split('\\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))[0] || text.trim();
      return line.length > max ? line.slice(0, max) + '...' : line;
    }

    function renderEvent(ev) {
      const t = ev.type;
      let cls = t.replace(/\\./g, '-');
      let body = '';

      if (t === 'creature.intent') {
        const turns = ev.turns || 1;
        const acts = ev.actions || 0;
        const badge = '<span class="tool-ms">' + turns + 't/' + acts + 'a</span>';
        const summary = summarize(ev.text, 120);
        const full = ev.text || '';
        const id = 'i' + Date.now() + Math.random().toString(36).slice(2,6);
        body = '<span class="type intent">think</span>'
          + badge
          + '<span class="intent-text thought-summary" onclick="toggleThought(\\''+id+'\\')"> — ' + esc(summary) + '</span>'
          + '<div class="thought-body" id="'+id+'">' + esc(full) + '</div>';
      } else if (t === 'creature.tool_call') {
        const toolName = ev.tool || 'bash';
        const isBrowser = toolName === 'browser';
        const okFail = ev.ok ? '<span class="tool-status ok">ok</span>' : '<span class="tool-status err">fail</span>';
        cls += ev.ok ? '' : ' fail';
        cls += isBrowser ? ' browser' : '';
        const toolCls = 'type tool' + (isBrowser ? ' browser' : '') + (ev.ok ? '' : ' fail');
        body = '<span class="' + toolCls + '">' + esc(toolName) + '</span>'
          + '<code class="tool-cmd">' + esc(ev.input) + '</code>'
          + okFail
          + '<span class="tool-ms">' + ev.ms + 'ms</span>';
        if (ev.output) {
          const outId = 'o' + Date.now() + Math.random().toString(36).slice(2,6);
          const outPreview = ev.output.length > 120 ? ev.output.slice(0, 120) + '...' : ev.output;
          if (ev.output.length > 120) {
            body += '<code class="tool-output thought-summary" onclick="toggleThought(\\''+outId+'\\')"> ' + esc(outPreview) + '</code>';
            body += '<code class="tool-output thought-body" id="'+outId+'">' + esc(ev.output) + '</code>';
          } else {
            body += '<code class="tool-output">' + esc(ev.output) + '</code>';
          }
        }
      } else if (t === 'host.promote') {
        body = '<span class="type promote">promoted</span><span class="detail"><span class="sha">' + ev.sha.slice(0,7) + '</span></span>';
      } else if (t === 'host.rollback') {
        body = '<span class="type rollback">rollback</span><span class="detail">' + esc(ev.reason) + ' <span class="sha">' + ev.from.slice(0,7) + '</span> → <span class="sha">' + ev.to.slice(0,7) + '</span></span>';
      } else if (t === 'host.spawn') {
        body = '<span class="type boot">spawn</span><span class="detail">pid ' + ev.pid + ' <span class="sha">' + ev.sha.slice(0,7) + '</span></span>';
      } else if (t === 'creature.boot') {
        body = '<span class="type boot">creature boot</span><span class="detail"><span class="sha">' + ev.sha.slice(0,7) + '</span></span>';
      } else if (t === 'host.boot') {
        body = '<span class="type host">host boot</span>';
      } else {
        body = '<span class="type host">' + esc(t) + '</span><span class="detail">' + esc(JSON.stringify(ev)) + '</span>';
      }

      return '<div class="event ' + cls + '"><span class="time">' + ts(ev.t) + '</span>' + body + '</div>';
    }

    sse.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      eventsEl.insertAdjacentHTML('beforeend', renderEvent(ev));
      eventsEl.scrollTop = eventsEl.scrollHeight;
    };

    setInterval(async () => {
      try {
        const res = await fetch('/status');
        const s = await res.json();
        document.getElementById('current').textContent = s.current_sha.slice(0, 7);
        document.getElementById('last_good').textContent = s.last_good_sha.slice(0, 7);
        document.getElementById('pid').textContent = s.pid || 'none';
        const h = document.getElementById('healthy');
        h.textContent = s.healthy ? 'yes' : 'no';
        h.className = s.healthy ? 'healthy-yes' : 'healthy-no';
      } catch {}
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
