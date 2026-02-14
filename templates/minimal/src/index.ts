import { mkdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';

import { Mind } from './mind.js';

const PORT = parseInt(process.env.PORT || "7778");
const HOST_URL = process.env.HOST_URL || "http://127.0.0.1:7770";
const CREATURE_NAME = process.env.CREATURE_NAME || "";
const BOOT_OK_FILE = ".self/boot-ok";
const AUTO_ITERATE = process.env.AUTO_ITERATE !== "false";

interface CreatureEvent {
  t?: string;
  type: string;
  [key: string]: unknown;
}

class Creature {
  private booted = false;
  private running = false;
  readonly mind = new Mind();

  async start() {
    this.createServer();
    await fs.mkdir(".self", { recursive: true });
    await fs.writeFile(BOOT_OK_FILE, "ok", "utf-8");
    this.booted = true;

    await this.emit({ type: "creature.boot" });

    if (AUTO_ITERATE) {
      console.log("[creature] starting cognition");
      this.runCognition();
    } else {
      console.log("[creature] ready, use POST /tick to start");
    }
  }

  private createServer() {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${PORT}`);

      if (url.pathname === "/healthz" && req.method === "GET") {
        res.writeHead(this.booted ? 200 : 503);
        res.end(this.booted ? "ok" : "not ready");
        return;
      }

      if (url.pathname === "/tick" && req.method === "POST") {
        if (!this.running) {
          this.runCognition();
          res.writeHead(200); res.end("started");
        } else {
          res.writeHead(409); res.end("already running");
        }
        return;
      }

      if (url.pathname === "/wake" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk: string) => (body += chunk));
        req.on("end", () => {
          let reason: string | undefined;
          try { reason = JSON.parse(body).reason; } catch {}
          const woke = this.mind.forceWake(reason || "external wake");
          res.writeHead(200);
          res.end(woke ? "woken" : "already_awake");
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
            res.writeHead(200); res.end("ok");
          } catch {
            res.writeHead(400); res.end("bad request");
          }
        });
        return;
      }

      res.writeHead(404); res.end("not found");
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

  private async runCognition() {
    if (this.running) return;
    this.running = true;
    console.log("[creature] cognition started");

    try {
      await this.mind.run(
        async (tool, args, result, ms) => {
          const input = String((args as any).command || "(empty)");
          const output = result.ok
            ? String((result.data as any)?.stdout || "").slice(0, 1000)
            : String(result.error || "").slice(0, 1000);
          await this.emit({ type: "creature.tool_call", tool, input, ok: result.ok, output, ms });
        },
        async (seconds, summary, actions) => {
          await this.emit({ type: "creature.sleep", seconds, text: summary, actions });
          console.log(`[creature] sleeping ${seconds}s`);
        },
        async (text) => {
          await this.emit({ type: "creature.thought", text });
        },
        undefined, // onDream
        undefined, // onProgressCheck
        undefined, // onSpecialTool
        async (reason, source) => {
          await this.emit({ type: "creature.wake", reason, source });
          console.log(`[creature] wake (${source}): ${reason}`);
        },
      );
    } catch (err) {
      console.error("[creature] cognition crashed:", err);
      this.running = false;
    }
  }
}

const creature = new Creature();
creature.start();

// Crash checkpoint — minimal version just logs
function onSignal(signal: string) {
  console.log(`[creature] received ${signal}`);
  const state = creature.mind.getState();
  if (state.actionCount > 0) {
    console.log(`[creature] interrupted with ${state.actionCount} actions in flight`);
  }
  process.exit(0);
}
process.on("SIGTERM", () => onSignal("SIGTERM"));
process.on("SIGINT", () => onSignal("SIGINT"));
