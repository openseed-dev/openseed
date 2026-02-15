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

const KNOWN_MODELS = [
  'claude-opus-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5',
  'gpt-5.2', 'gpt-5-mini', 'o4-mini',
];

interface SpawnOptions {
  name: string;
  purpose?: string;
  template?: string;
  model?: string;
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".self", ".sys"]);

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

  const tpl = templateDir(opts.template || 'dreamer');

  // Verify template exists
  try {
    await fs.access(tpl);
  } catch {
    console.error(`template not found at ${tpl}`);
    process.exit(1);
  }

  if (opts.model && !KNOWN_MODELS.includes(opts.model)) {
    console.error(`unknown model "${opts.model}". known models: ${KNOWN_MODELS.join(', ')}`);
    process.exit(1);
  }

  console.log(`spawning creature "${opts.name}"${opts.model ? ` with model ${opts.model}` : ''}...`);

  // Ensure parent dirs exist
  await fs.mkdir(CREATURES_DIR, { recursive: true });

  // Copy template into creature dir
  await copyDir(tpl, dir);

  // Write birth certificate
  const birth: Record<string, unknown> = {
    id: crypto.randomUUID(),
    name: opts.name,
    born: new Date().toISOString(),
    template: opts.template || 'dreamer',
    template_version: readVersion(),
    parent: null,
  };
  if (opts.model) birth.model = opts.model;
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

  // Build Docker image
  if (!isDockerAvailable()) {
    console.error("docker is required but not available. install Docker and try again.");
    process.exit(1);
  }
  console.log("building docker image...");
  execSync(`docker build -t creature-${opts.name} .`, { cwd: dir, stdio: "inherit" });
  console.log(`docker image creature-${opts.name} built`);

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
