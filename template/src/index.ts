import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';

import { Memory } from './memory.js';
import { Mind } from './mind.js';

const PORT = parseInt(process.env.PORT || "7778");
const HOST_URL = process.env.HOST_URL || "http://127.0.0.1:7770";
const CREATURE_NAME = process.env.CREATURE_NAME || "";
const BOOT_OK_FILE = ".self/boot-ok";
const AUTO_ITERATE = process.env.AUTO_ITERATE !== "false";

function getCurrentSHA(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

interface CreatureEvent {
  t?: string;
  type: string;
  [key: string]: unknown;
}

class Creature {
  private booted = false;
  private running = false;
  private memory = new Memory();
  private mind = new Mind(this.memory);
  private heartbeatInterval: NodeJS.Timeout | null = null;

  async start() {
    this.createServer();

    await this.memory.init();

    await fs.mkdir(".self", { recursive: true });
    await fs.writeFile(BOOT_OK_FILE, "ok", "utf-8");
    this.booted = true;

    const sha = getCurrentSHA();
    await this.emit({ type: "creature.boot", sha });
    await this.memory.append("heartbeat", { sha, event: "boot" });

    this.startHeartbeat();

    if (AUTO_ITERATE) {
      console.log("[creature] starting cognition");
      this.runCognition();
    } else {
      console.log("[creature] ready, use POST /tick to start cognition");
    }
  }

  private createServer() {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${PORT}`);

      if (url.pathname === "/healthz" && req.method === "GET") {
        if (this.booted) {
          res.writeHead(200);
          res.end("ok");
        } else {
          res.writeHead(503);
          res.end("not ready");
        }
        return;
      }

      if (url.pathname === "/tick" && req.method === "POST") {
        if (!this.running) {
          this.runCognition();
          res.writeHead(200);
          res.end("cognition started");
        } else {
          res.writeHead(409);
          res.end("already running");
        }
        return;
      }

      if (url.pathname === "/wake" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk: string) => (body += chunk));
        req.on("end", () => {
          let reason: string | undefined;
          try { reason = JSON.parse(body).reason; } catch {}
          this.mind.forceWake(reason || "Your creator woke you manually");
          res.writeHead(200);
          res.end("ok");
        });
        return;
      }

      if (url.pathname === "/message" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk: string) => (body += chunk));
        req.on("end", () => {
          try {
            const { text } = JSON.parse(body);
            this.mind.inject(text);
            res.writeHead(200);
            res.end("ok");
          } catch {
            res.writeHead(400);
            res.end("bad request");
          }
        });
        return;
      }

      res.writeHead(404);
      res.end("not found");
    });

    server.listen(PORT, () => {
      console.log(`[creature] listening on http://localhost:${PORT}`);
    });
  }

  private async emit(event: CreatureEvent) {
    const fullEvent = { t: new Date().toISOString(), ...event };
    const eventUrl = CREATURE_NAME
      ? `${HOST_URL}/api/creatures/${CREATURE_NAME}/event`
      : `${HOST_URL}/event`;
    try {
      await fetch(eventUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fullEvent),
      });
    } catch (err) {
      console.error("[creature] failed to emit event", err);
    }
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    this.heartbeatInterval = setInterval(async () => {
      await this.memory.append("heartbeat", { timestamp: new Date().toISOString() });
    }, 5000);
  }

  private async runCognition() {
    if (this.running) {
      console.log("[creature] cognition already running");
      return;
    }

    this.running = true;
    console.log("[creature] cognition started");

    try {
      // mind.run() never returns — it's the single agentic loop
      await this.mind.run(
        // onToolResult — emit tool call events to host
        async (tool, args, result, ms) => {
          let input: string;
          let output: string;

          if (tool === "bash") {
            input = args.command as string;
            output = result.ok
              ? String((result.data as any)?.stdout || "").slice(0, 1000)
              : String(result.error || "").slice(0, 1000);
          } else if (tool === "browser") {
            const a = args.action as string;
            const sel = args.selector as string;
            const url = args.url as string;
            input = `${a}${url ? ` ${url}` : ""}${sel ? ` "${sel}"` : ""}`;
            output = result.ok
              ? String((result.data as any)?.snapshot || (result.data as any)?.data || "").slice(0, 1000)
              : String(result.error || "").slice(0, 1000);
          } else {
            input = JSON.stringify(args);
            output = result.ok
              ? JSON.stringify(result.data).slice(0, 1000)
              : String(result.error || "").slice(0, 1000);
          }

          await this.emit({
            type: "creature.tool_call",
            tool,
            input,
            ok: result.ok,
            output,
            ms,
          });
        },

        // onSleep — emit sleep checkpoint event to host
        async (seconds, summary, actions, watch) => {
          await this.emit({
            type: "creature.sleep",
            seconds,
            text: summary,
            actions,
            ...(watch?.length ? { watch } : {}),
          });
          console.log(`[creature] sleeping ${seconds}s — ${summary.slice(0, 80)}`);
        },

        // onThought — emit creature thinking/monologue to host
        async (text) => {
          await this.emit({ type: "creature.thought", text });
        },

        // onDream — emit consolidation/dream event to host
        async (dream) => {
          await this.emit({
            type: "creature.dream",
            reflection: dream.reflection,
            priority: dream.priority,
            observations: dream.observations,
            deep: dream.deep,
          });
          console.log(`[creature] dream #${dream.observations} obs, deep=${dream.deep} — ${dream.priority.slice(0, 80)}`);
        },

        // onProgressCheck — emit progress check event to host
        async (actions) => {
          await this.emit({ type: "creature.progress_check", actions });
          console.log(`[creature] progress check at ${actions} actions`);
        },

        // onSpecialTool — emit request_restart or request_evolution events
        async (tool, reason) => {
          await this.emit({ type: `creature.${tool}`, reason });
          console.log(`[creature] ${tool}: ${reason.slice(0, 80)}`);
        },

        // onWake — emit wake event (only for natural timer expiry; manual/watcher wakes are emitted by orchestrator)
        async (reason, source) => {
          await this.emit({ type: "creature.wake", reason, source });
          console.log(`[creature] wake (${source}): ${reason}`);
        },
      );
    } catch (err) {
      console.error("[creature] cognition crashed:", err);
      await this.memory.append("observation", {
        error: err instanceof Error ? err.message : String(err),
      });
      this.running = false;
    }
  }
}

const creature = new Creature();
creature.start();
