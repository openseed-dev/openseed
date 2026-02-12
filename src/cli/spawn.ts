import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  creatureDir,
  CREATURES_DIR,
  templateDir,
} from './paths.js';
import { readVersion } from './version.js';

interface SpawnOptions {
  name: string;
  purpose?: string;
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".self"]);

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

export async function spawn(opts: SpawnOptions): Promise<void> {
  const dir = creatureDir(opts.name);

  // Check if creature already exists
  try {
    await fs.access(dir);
    console.error(`creature "${opts.name}" already exists at ${dir}`);
    process.exit(1);
  } catch {
    // Good — doesn't exist yet
  }

  const tpl = templateDir();

  // Verify template exists
  try {
    await fs.access(tpl);
  } catch {
    console.error(`template not found at ${tpl}`);
    process.exit(1);
  }

  console.log(`spawning creature "${opts.name}"...`);

  // Ensure parent dirs exist
  await fs.mkdir(CREATURES_DIR, { recursive: true });

  // Copy template into creature dir
  await copyDir(tpl, dir);

  // Write birth certificate
  const birth = {
    id: crypto.randomUUID(),
    name: opts.name,
    born: new Date().toISOString(),
    template_version: readVersion(),
    parent: null,
  };
  await fs.writeFile(path.join(dir, "BIRTH.json"), JSON.stringify(birth, null, 2) + "\n", "utf-8");

  // Override PURPOSE.md if custom purpose provided
  if (opts.purpose) {
    await fs.writeFile(path.join(dir, "PURPOSE.md"), `# Purpose\n\n${opts.purpose}\n`, "utf-8");
  }

  // Install dependencies
  console.log("installing dependencies...");
  execSync("pnpm install --silent", { cwd: dir, stdio: "inherit" });

  // Initialize git repo and make genesis commit
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync('git commit -m "genesis"', { cwd: dir, stdio: "pipe" });

  // Build Docker image if Docker is available
  if (isDockerAvailable()) {
    console.log("building docker image...");
    try {
      execSync(`docker build -t creature-${opts.name} .`, { cwd: dir, stdio: "inherit" });
      console.log(`docker image creature-${opts.name} built`);
    } catch (err) {
      console.warn("docker build failed — creature will run in bare mode");
    }
  } else {
    console.log("docker not available — creature will run in bare mode");
  }

  console.log(`creature "${opts.name}" spawned at ${dir}`);
  console.log(`  id: ${birth.id}`);
  console.log(`  born: ${birth.born}`);
  console.log(`\nstart it with: itsalive start ${opts.name}`);
}

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
