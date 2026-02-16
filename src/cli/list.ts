import fs from "node:fs/promises";
import path from "node:path";
import { CREATURES_DIR } from "./paths.js";
import { readOrchestratorInfo } from "./ports.js";

interface BirthInfo {
  id: string;
  name: string;
  born: string;
  genome_version: string;
  parent: string | null;
}

export async function list(): Promise<void> {
  // Prefer orchestrator API if available
  const info = await readOrchestratorInfo();
  if (info) {
    try {
      const res = await fetch(`http://127.0.0.1:${info.port}/api/creatures`);
      const creatures = (await res.json()) as Array<{ name: string; status: string; sha: string | null; port: number | null }>;

      if (creatures.length === 0) {
        console.log("no creatures yet. spawn one with: itsalive spawn <name>");
        return;
      }

      const nameW = Math.max(6, ...creatures.map((c) => c.name.length));
      console.log(
        ["NAME".padEnd(nameW), "STATUS".padEnd(10), "SHA".padEnd(9), "PORT"].join("  ")
      );
      for (const c of creatures) {
        console.log(
          [
            c.name.padEnd(nameW),
            c.status.padEnd(10),
            (c.sha ? c.sha.slice(0, 7) : "-").padEnd(9),
            c.port ? String(c.port) : "-",
          ].join("  ")
        );
      }
      return;
    } catch {
      // Orchestrator unreachable, fall through to filesystem scan
    }
  }

  // Fallback: filesystem scan
  let entries: string[];
  try {
    entries = await fs.readdir(CREATURES_DIR);
  } catch {
    console.log("no creatures yet. spawn one with: itsalive spawn <name>");
    return;
  }

  const creatures: Array<{ name: string; born: string; status: string; parent: string }> = [];

  for (const name of entries) {
    const dir = path.join(CREATURES_DIR, name);
    let birth: BirthInfo;
    try {
      const content = await fs.readFile(path.join(dir, "BIRTH.json"), "utf-8");
      birth = JSON.parse(content);
    } catch {
      continue;
    }

    creatures.push({
      name: birth.name,
      born: birth.born.slice(0, 10),
      status: "unknown",
      parent: birth.parent || "-",
    });
  }

  if (creatures.length === 0) {
    console.log("no creatures yet. spawn one with: itsalive spawn <name>");
    return;
  }

  const nameW = Math.max(6, ...creatures.map((c) => c.name.length));
  console.log(
    ["NAME".padEnd(nameW), "BORN".padEnd(10), "STATUS".padEnd(10), "PARENT"].join("  ")
  );
  for (const c of creatures) {
    console.log(
      [c.name.padEnd(nameW), c.born.padEnd(10), c.status.padEnd(10), c.parent].join("  ")
    );
  }

  if (!info) {
    console.log("\nstart the orchestrator with: itsalive up");
  }
}
