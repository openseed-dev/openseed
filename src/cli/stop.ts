import fs from "node:fs/promises";
import path from "node:path";
import { creatureDir } from "./paths.js";
import { readRunFile } from "./ports.js";

interface StopOptions {
  name: string;
}

export async function stop(opts: StopOptions): Promise<void> {
  const dir = creatureDir(opts.name);

  const runInfo = await readRunFile(dir);
  if (!runInfo) {
    console.log(`creature "${opts.name}" is not running`);
    return;
  }

  try {
    process.kill(runInfo.host_pid, 0);
  } catch {
    // Already dead — clean up stale run file
    await fs.unlink(path.join(dir, ".self", "run.json")).catch(() => {});
    console.log(`creature "${opts.name}" is not running (cleaned stale lock)`);
    return;
  }

  console.log(`stopping creature "${opts.name}" (pid ${runInfo.host_pid})...`);
  process.kill(runInfo.host_pid, "SIGTERM");

  // Wait for process to die (up to 5s)
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      process.kill(runInfo.host_pid, 0);
    } catch {
      console.log(`creature "${opts.name}" stopped`);
      return;
    }
  }

  // Force kill
  console.log("force killing...");
  process.kill(runInfo.host_pid, "SIGKILL");
  await fs.unlink(path.join(dir, ".self", "run.json")).catch(() => {});
  console.log(`creature "${opts.name}" killed`);
}
