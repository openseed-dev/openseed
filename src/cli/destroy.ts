import fs from "node:fs/promises";
import path from "node:path";
import { creatureDir } from "./paths.js";
import { stop } from "./stop.js";

interface DestroyOptions {
  name: string;
}

export async function destroy(opts: DestroyOptions): Promise<void> {
  const dir = creatureDir(opts.name);

  // Verify it exists
  try {
    await fs.access(path.join(dir, "BIRTH.json"));
  } catch {
    console.error(`creature "${opts.name}" not found`);
    process.exit(1);
  }

  // Stop if running
  await stop({ name: opts.name });

  console.log(`destroying creature "${opts.name}"...`);
  await fs.rm(dir, { recursive: true, force: true });
  console.log(`creature "${opts.name}" destroyed`);
}
