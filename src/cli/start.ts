import {
  execSync,
  spawn,
} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { creatureDir } from './paths.js';
import {
  allocatePorts,
  readRunFile,
} from './ports.js';

interface StartOptions {
  name: string;
  manual: boolean;
  bare: boolean;
}

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hasDockerImage(name: string): boolean {
  try {
    const out = execSync(`docker images -q creature-${name}`, { encoding: "utf-8" }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

export async function start(opts: StartOptions): Promise<void> {
  const dir = creatureDir(opts.name);

  // Verify creature exists
  try {
    await fs.access(path.join(dir, "BIRTH.json"));
  } catch {
    console.error(`creature "${opts.name}" not found at ${dir}`);
    process.exit(1);
  }

  // Check if already running
  const existing = await readRunFile(dir);
  if (existing) {
    try {
      process.kill(existing.host_pid, 0);
      console.error(`creature "${opts.name}" is already running (pid ${existing.host_pid}, host port ${existing.host_port})`);
      process.exit(1);
    } catch {
      // Stale run file, clean it up
      await fs.unlink(path.join(dir, ".self", "run.json")).catch(() => {});
    }
  }

  // Determine sandboxed mode: use Docker if available and image exists, unless --bare
  const sandboxed = !opts.bare && isDockerAvailable() && hasDockerImage(opts.name);
  if (sandboxed) {
    console.log(`starting creature "${opts.name}" (sandboxed)...`);
  } else {
    if (!opts.bare && isDockerAvailable()) {
      console.log(`no docker image for "${opts.name}" — running bare (build with: docker build -t creature-${opts.name} <creature-dir>)`);
    }
    console.log(`starting creature "${opts.name}" (bare)...`);
  }

  const { hostPort, creaturePort } = await allocatePorts();

  console.log(`  host:     http://localhost:${hostPort}`);
  console.log(`  creature: http://localhost:${creaturePort}`);

  // Resolve host entry point relative to the itsalive repo
  const hostScript = path.resolve(import.meta.dirname, "..", "host", "index.ts");

  // Spawn the host process, which in turn spawns the creature
  const child = spawn("tsx", [hostScript], {
    stdio: "inherit",
    env: {
      ...process.env,
      CREATURE_DIR: dir,
      CREATURE_NAME: opts.name,
      HOST_PORT: String(hostPort),
      CREATURE_PORT: String(creaturePort),
      AUTO_ITERATE: opts.manual ? "false" : "true",
      SANDBOXED: sandboxed ? "true" : "false",
    },
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });

  // Forward signals to the host process
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}
