import {
  appendFileSync,
  mkdirSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';

import { Mind } from './mind.js';

const PORT = parseInt(process.env.PORT || "7778");
const HOST_URL = process.env.HOST_URL || "http://127.0.0.1:7770";
const CREATURE_NAME = process.env.CREATURE_NAME || "";
const BOOT_OK_FILE = ".sys/boot-ok";
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
  readonly mind = new Mind();

  async start() {
    this.createServer();

    await fs.mkdir(".sys", { recursive: true });
    await fs.mkdir(".self", { recursive: true });
    await fs.mkdir(".self/skills", { recursive: true });
    await fs.writeFile(BOOT_OK_FILE, "ok", "utf-8");
    this.booted = true;

    const sha = getCurrentSHA();
    await this.emit({ type: "creature.boot", sha });

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
          const woke = this.mind.forceWake(reason || "Your creator woke you manually");
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

  private async runCognition() {
    if (this.running) return;
    this.running = true;
    console.log("[creature] cognition started");

    try {
      await this.mind.run(
        // onToolResult
        async (tool, args, result, ms) => {
          let input: string;
          let output: string;

          if (tool === "bash") {
            input = String(args.command || "(empty)");
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

          await this.emit({ type: "creature.tool_call", tool, input, ok: result.ok, output, ms });
        },

        // onSleep
        async (seconds, summary, actions) => {
          await this.emit({ type: "creature.sleep", seconds, text: summary, actions });
          console.log(`[creature] sleeping ${seconds}s, ${summary.slice(0, 80)}`);
        },

        // onThought
        async (text) => {
          await this.emit({ type: "creature.thought", text });
        },

        // onWake
        async (reason, source) => {
          await this.emit({ type: "creature.wake", reason, source });
          console.log(`[creature] wake (${source}): ${reason}`);
        },

        // onError
        async (error, retryIn, retries) => {
          await this.emit({ type: "creature.error", error, retryIn, retries } as any);
        },

        // onCycle
        async (cycle) => {
          await this.emit({
            type: "creature.cycle_complete",
            task: cycle.task,
            outcome: cycle.outcome,
            skills: cycle.skills,
            actions: cycle.actions,
          });
          console.log(`[creature] cycle complete: ${cycle.outcome}, ${cycle.skills.length} skills committed`);
        },

        // onSkill
        async (skill) => {
          await this.emit({
            type: "creature.skill_committed",
            name: skill.name,
            description: skill.description,
            language: skill.language,
          });
          console.log(`[creature] skill committed: ${skill.name}`);
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

function writeCrashCheckpoint(signal: string) {
  console.log(`[creature] received ${signal}, writing crash checkpoint…`);
  try {
    const state = creature.mind.getState();
    if (state.actionCount === 0) {
      console.log("[creature] no actions this session, skipping crash checkpoint");
      process.exit(0);
    }
    const checkpoint = {
      t: new Date().toISOString(),
      turns: 0,
      intent: state.intent || "unknown (interrupted)",
      actions: [],
      sleep_s: 0,
      interrupted: true,
      action_count: state.actionCount,
    };
    mkdirSync(".sys", { recursive: true });
    appendFileSync(".sys/iterations.jsonl", JSON.stringify(checkpoint) + "\n", "utf-8");
    console.log(`[creature] crash checkpoint saved (${state.actionCount} actions, intent: ${state.intent.slice(0, 60)})`);
  } catch (err) {
    console.error("[creature] failed to write crash checkpoint:", err);
  }
  process.exit(0);
}

process.on("SIGTERM", () => writeCrashCheckpoint("SIGTERM"));
process.on("SIGINT", () => writeCrashCheckpoint("SIGINT"));
