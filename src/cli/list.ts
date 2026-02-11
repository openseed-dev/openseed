import fs from "node:fs/promises";
import path from "node:path";
import { CREATURES_DIR } from "./paths.js";
import { readRunFile } from "./ports.js";

interface BirthInfo {
  id: string;
  name: string;
  born: string;
  template_version: string;
  parent: string | null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function list(): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(CREATURES_DIR);
  } catch {
    console.log("no creatures yet. spawn one with: itsalive spawn <name>");
    return;
  }

  const creatures: Array<{
    name: string;
    born: string;
    status: string;
    ports: string;
    parent: string;
  }> = [];

  for (const name of entries) {
    const dir = path.join(CREATURES_DIR, name);

    let birth: BirthInfo;
    try {
      const content = await fs.readFile(path.join(dir, "BIRTH.json"), "utf-8");
      birth = JSON.parse(content);
    } catch {
      continue; // Not a valid creature
    }

    const runInfo = await readRunFile(dir);
    let status = "stopped";
    let ports = "-";

    if (runInfo) {
      if (isProcessAlive(runInfo.host_pid)) {
        status = "running";
        ports = `${runInfo.host_port}/${runInfo.creature_port}`;
      } else {
        // Stale run file — clean it up
        await fs.unlink(path.join(dir, ".self", "run.json")).catch(() => {});
      }
    }

    creatures.push({
      name: birth.name,
      born: birth.born.slice(0, 10),
      status,
      ports,
      parent: birth.parent || "-",
    });
  }

  if (creatures.length === 0) {
    console.log("no creatures yet. spawn one with: itsalive spawn <name>");
    return;
  }

  // Print table
  const nameW = Math.max(6, ...creatures.map((c) => c.name.length));
  const header = [
    "NAME".padEnd(nameW),
    "BORN".padEnd(10),
    "STATUS".padEnd(8),
    "PORTS".padEnd(11),
    "PARENT",
  ].join("  ");

  console.log(header);

  for (const c of creatures) {
    console.log(
      [
        c.name.padEnd(nameW),
        c.born.padEnd(10),
        c.status.padEnd(8),
        c.ports.padEnd(11),
        c.parent,
      ].join("  ")
    );
  }
}
