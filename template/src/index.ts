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
        const thought = await this.mind.think();

        await this.emit({
          type: "creature.intent",
          text: thought.intent,
        });

        console.log(`[creature] monologue: ${thought.monologue.slice(0, 100)}...`);
        console.log(`[creature] intent: ${thought.intent}`);
        console.log(`[creature] tool_calls: ${thought.tool_calls.length}`);

        if (thought.tool_calls.length > 0) {
          await this.mind.executeTools(thought.tool_calls, async (tool, args, result, ms) => {
            const input = tool === "bash" ? (args.command as string) : JSON.stringify(args);
            const output = result.ok
              ? String((result.data as any)?.stdout || "").slice(0, 1000)
              : String(result.error || "").slice(0, 1000);
            await this.emit({
              type: "creature.tool_call",
              tool,
              input,
              ok: result.ok,
              output,
              ms,
            });
          });
          console.log("[creature] tools done, thinking again immediately");
        } else {
          const sleepMs = thought.sleep_s * 1000;
          console.log(`[creature] idle, sleeping for ${thought.sleep_s}s`);
          await new Promise((resolve) => setTimeout(resolve, sleepMs));
        }
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
