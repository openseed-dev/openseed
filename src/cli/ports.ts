import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { CREATURES_DIR } from "./paths.js";

const BASE_PORT = 7770;

interface RunInfo {
  host_port: number;
  creature_port: number;
  host_pid: number;
  creature_name: string;
  started_at: string;
}

export async function readRunFile(creatureDir: string): Promise<RunInfo | null> {
  try {
    const content = await fs.readFile(path.join(creatureDir, ".self", "run.json"), "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

export async function allocatePorts(): Promise<{ hostPort: number; creaturePort: number }> {
  // Collect ports already in use by running creatures
  const usedPorts = new Set<number>();

  try {
    const entries = await fs.readdir(CREATURES_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const runInfo = await readRunFile(path.join(CREATURES_DIR, entry.name));
      if (runInfo) {
        usedPorts.add(runInfo.host_port);
        usedPorts.add(runInfo.creature_port);
      }
    }
  } catch {
    // No creatures dir yet
  }

  // Find two consecutive available ports starting from BASE_PORT
  let port = BASE_PORT;
  while (port < 65534) {
    const hostPort = port;
    const creaturePort = port + 1;

    if (!usedPorts.has(hostPort) && !usedPorts.has(creaturePort)) {
      const [hostAvail, creatureAvail] = await Promise.all([
        isPortAvailable(hostPort),
        isPortAvailable(creaturePort),
      ]);

      if (hostAvail && creatureAvail) {
        return { hostPort, creaturePort };
      }
    }

    port += 2;
  }

  throw new Error("no available ports found");
}
