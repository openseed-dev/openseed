import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  creatureDir,
  CREATURES_DIR,
} from './paths.js';
import { readRunFile } from './ports.js';

interface ForkOptions {
  source: string;
  name: string;
}

async function copyDir(src: string, dest: string, skip?: Set<string>): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (skip?.has(entry.name)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export async function fork(opts: ForkOptions): Promise<void> {
  if (!NAME_RE.test(opts.source)) {
    console.error(`invalid source name "${opts.source}" (lowercase alphanumeric + hyphens)`);
    process.exit(1);
  }
  if (!NAME_RE.test(opts.name)) {
    console.error(`invalid fork name "${opts.name}" (lowercase alphanumeric + hyphens)`);
    process.exit(1);
  }

  const sourceDir = creatureDir(opts.source);
  const destDir = creatureDir(opts.name);

  // Verify source exists
  let sourceBirth: { id: string; name: string; genome?: string; genome_version?: string; genome_repo?: string; genome_sha?: string };
  try {
    const content = await fs.readFile(path.join(sourceDir, "BIRTH.json"), "utf-8");
    sourceBirth = JSON.parse(content);
  } catch {
    console.error(`creature "${opts.source}" not found`);
    process.exit(1);
  }

  // Check source isn't running (git state should be clean)
  const runInfo = await readRunFile(sourceDir);
  if (runInfo) {
    try {
      process.kill(runInfo.host_pid, 0);
      console.error(`creature "${opts.source}" is running, stop it first to fork cleanly`);
      process.exit(1);
    } catch {
      // Not actually running, stale file
    }
  }

  // Check dest doesn't exist
  try {
    await fs.access(destDir);
    console.error(`creature "${opts.name}" already exists`);
    process.exit(1);
  } catch {
    // Good
  }

  console.log(`forking "${opts.source}" → "${opts.name}"...`);

  await fs.mkdir(CREATURES_DIR, { recursive: true });

  // Skip host state (.sys), runtime state (.self), and deps (node_modules)
  await copyDir(sourceDir, destDir, new Set([".self", ".sys", "node_modules"]));

  // Get the current SHA of the source before we modify anything
  const forkedAtSHA = execSync("git rev-parse HEAD", {
    encoding: "utf-8",
    cwd: sourceDir,
  }).trim();

  // Write new birth certificate
  const birth = {
    id: crypto.randomUUID(),
    name: opts.name,
    born: new Date().toISOString(),
    genome: sourceBirth!.genome || null,
    genome_version: sourceBirth!.genome_version || null,
    ...(sourceBirth!.genome_repo ? { genome_repo: sourceBirth!.genome_repo } : {}),
    ...(sourceBirth!.genome_sha ? { genome_sha: sourceBirth!.genome_sha } : {}),
    parent: sourceBirth!.id,
    forked_from: opts.source,
    forked_at_sha: forkedAtSHA,
  };
  await fs.writeFile(path.join(destDir, "BIRTH.json"), JSON.stringify(birth, null, 2) + "\n", "utf-8");

  // Install deps (node_modules weren't copied)
  console.log("installing dependencies...");
  execSync("pnpm install --silent", { cwd: destDir, stdio: "inherit" });

  // Commit the fork as a new point in the forked creature's history
  execSync("git add -A", { cwd: destDir, stdio: "pipe" });
  execSync(`git commit -m "forked from ${opts.source} at ${forkedAtSHA.slice(0, 7)}"`, {
    cwd: destDir,
    stdio: "pipe",
  });

  console.log(`creature "${opts.name}" forked from "${opts.source}"`);
  console.log(`  id: ${birth.id}`);
  console.log(`  parent: ${opts.source} (${sourceBirth!.id})`);
  console.log(`  forked at: ${forkedAtSHA.slice(0, 7)}`);
  console.log(`\nstart it with: seed start ${opts.name}`);
}
