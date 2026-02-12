import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { creatureDir } from "./paths.js";
import { readOrchestratorInfo } from "./ports.js";

interface DestroyOptions {
  name: string;
}

export async function destroy(opts: DestroyOptions): Promise<void> {
  const dir = creatureDir(opts.name);

  try {
    await fs.access(path.join(dir, "BIRTH.json"));
  } catch {
    console.error(`creature "${opts.name}" not found`);
    process.exit(1);
  }

  // Try to stop via orchestrator
  const info = await readOrchestratorInfo();
  if (info) {
    try {
      await fetch(`http://127.0.0.1:${info.port}/api/creatures/${opts.name}/stop`, { method: 'POST' });
    } catch { /* orchestrator may not have it running */ }
  }

  // Also try direct docker kill as fallback
  try { execSync(`docker kill creature-${opts.name}`, { stdio: 'ignore' }); } catch {}
  try { execSync(`docker rm -f creature-${opts.name}`, { stdio: 'ignore' }); } catch {}

  console.log(`destroying creature "${opts.name}"...`);
  await fs.rm(dir, { recursive: true, force: true });
  console.log(`creature "${opts.name}" destroyed`);
}
