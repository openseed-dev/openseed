import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";

import { Memory } from "./memory.js";
import { Mind } from "./mind.js";

const PORT = parseInt(process.env.PORT || "7778");
const HOST_URL = process.env.HOST_URL || "http://127.0.0.1:7777";
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
      console.log("[creature] starting cognition loop");
      this.runCognitionLoop();
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
          this.runCognitionLoop();
          res.writeHead(200);
          res.end("cognition loop started");
        } else {
          res.writeHead(409);
          res.end("already running");
        }
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
    try {
      await fetch(`${HOST_URL}/event`, {
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

  private async runCognitionLoop() {
    if (this.running) {
      console.log("[creature] cognition loop already running");
      return;
    }

    this.running = true;
    console.log("[creature] cognition loop started");

    while (this.running) {
      try {
        console.log("[creature] thinking...");
        const thought = await this.mind.think(async (tool, args, result, ms) => {
          // Emit tool call events to the host as they happen
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
        });

        // Emit the final intent
        await this.emit({
          type: "creature.intent",
          text: thought.monologue,
          turns: thought.turns,
          actions: thought.actions.length,
        });

        console.log(`[creature] intent: ${thought.intent.slice(0, 100)}`);
        console.log(`[creature] turns: ${thought.turns}, actions: ${thought.actions.length}`);

        // Sleep before next iteration
        const sleepMs = thought.sleep_s * 1000;
        console.log(`[creature] sleeping for ${thought.sleep_s}s`);
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
      } catch (err) {
        console.error("[creature] error in cognition loop:", err);
        await this.memory.append("observation", {
          error: err instanceof Error ? err.message : String(err),
        });

        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }
  }
}

const creature = new Creature();
creature.start();
