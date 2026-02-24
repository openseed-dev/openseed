import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  creatureDir,
  CREATURES_DIR,
} from './paths.js';
import { readRunFile } from './ports.js';
import { copyDir } from '../shared/fs.js';

interface ForkOptions {
  source: string;
  name: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export async function fork(opts: ForkOptions): Promise<void> {
  if (!NAME_RE.test(opts.source)) {
    console.error(`invalid source name "${opts.source}" (lowercase alphanumeric + hyphens only)`);
    process.exit(1);
  }
  if (!NAME_RE.test(opts.name)) {
    console.error(`invalid fork name "${opts.name}" (lowercase alphanumeric + hyphens only)`);
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

  // Get the current SHA of the source before we modify anything
  let forkedAtSHA: string;
  try {
    forkedAtSHA = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      cwd: sourceDir,
    }).trim();
  } catch {
    console.error(`creature "${opts.source}" has no git history (not initialized)`);
    process.exit(1);
  }

  // Copy source to dest, skipping runtime state (.self), host state (.sys),
  // deps (node_modules), and git history (.git — the fork gets a fresh repo below)
  await copyDir(sourceDir, destDir, new Set([".self"])); // .git/.sys/node_modules already skipped by default

  try {
    // Initialize a fresh git repo in the fork — gives it a clean single-commit
    // history rather than inheriting the full source history
    execFileSync('git', ['init'], { cwd: destDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'openseed@openseed.dev'], { cwd: destDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'openseed'], { cwd: destDir, stdio: 'pipe' });

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
    execFileSync('pnpm', ['install', '--silent'], { cwd: destDir, stdio: 'inherit' });

    // Commit the fork as the first point in the forked creature's history
    execFileSync('git', ['add', '-A'], { cwd: destDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', `forked from ${opts.source} at ${forkedAtSHA.slice(0, 7)}`], {
      cwd: destDir,
      stdio: 'pipe',
    });

    console.log(`creature "${opts.name}" forked from "${opts.source}"`);
    console.log(`  id: ${birth.id}`);
    console.log(`  parent: ${opts.source} (${sourceBirth!.id})`);
    console.log(`  forked at: ${forkedAtSHA.slice(0, 7)}`);
    console.log(`\nstart it with: seed start ${opts.name}`);
  } catch (err) {
    // Clean up partial destination so the user can retry with the same name
    console.error(`fork failed, cleaning up ${destDir}`);
    try {
      await fs.rm(destDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error(`warning: failed to remove orphaned directory ${destDir}:`, cleanupErr);
    }
    throw err;
  }
}
