import http from "node:http";
import fs from "node:fs/promises";
import { getCurrentSHA } from "../host/git.js";
import { decidePatch } from "./evolve.js";
import { runChecks, gitCommit } from "./apply.js";
import { Event } from "../shared/types.js";

const PORT = parseInt(process.env.PORT || "7778");
const HOST_URL = "http://127.0.0.1:7777";
const BOOT_OK_FILE = ".self/boot-ok";

class Creature {
  private booted = false;

  async start() {
    this.createServer();
    await this.runIteration();
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

      res.writeHead(404);
      res.end("not found");
    });

    server.listen(PORT, () => {
      console.log(`[creature] listening on http://localhost:${PORT}`);
    });
  }

  private async emit(event: Omit<Event, "t">) {
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

  private async runIteration() {
    const sha = getCurrentSHA();
    await this.emit({ type: "creature.boot", sha });

    // Mark as booted so health checks pass
    await fs.writeFile(BOOT_OK_FILE, "ok", "utf-8");
    this.booted = true;

    await this.emit({ type: "creature.intent", text: "Deciding on a small patch" });

    const patch = await decidePatch();
    await this.emit({ type: "creature.patch", summary: patch.summary, files: patch.files });

    console.log(`[creature] applying patch: ${patch.summary}`);
    await patch.apply();

    console.log("[creature] running checks");
    const checkResult = await runChecks();
    await this.emit({
      type: "creature.checks",
      cmd: "pnpm -s test",
      ok: checkResult.ok,
      ms: checkResult.ms,
      out_tail: checkResult.out_tail,
    });

    if (!checkResult.ok) {
      console.error("[creature] checks failed, exiting");
      await fs.appendFile("self/diary.md", `\n**FAILURE**: ${new Date().toISOString()} - Checks failed\n\n`, "utf-8").catch(() => {});
      process.exit(1);
    }

    console.log("[creature] checks passed, committing");
    const newSHA = gitCommit(`self: ${patch.summary}`);

    await this.emit({ type: "creature.request_restart", sha: newSHA });

    console.log("[creature] requesting restart");
    await fetch(`${HOST_URL}/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newSHA }),
    });
  }
}

const creature = new Creature();
creature.start();
