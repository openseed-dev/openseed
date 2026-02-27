import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Validate a genome source string to prevent shell injection.
 * Allows: alphanumeric, hyphens, underscores, dots, forward slashes (for owner/repo paths).
 * Rejects: semicolons, backticks, $, pipes, ampersands, newlines, spaces, etc.
 */
function validateGenomeSource(source: string): void {
  if (!source || source.length > 200) {
    throw new Error(`invalid genome source: too long or empty`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._\-\/]*$/.test(source)) {
    throw new Error(`invalid genome source "${source}": contains disallowed characters`);
  }
  // Block path traversal
  if (source.includes('..')) {
    throw new Error(`invalid genome source "${source}": path traversal not allowed`);
  }
}


export const OPENSEED_HOME = process.env.OPENSEED_HOME || process.env.ITSALIVE_HOME || path.join(os.homedir(), ".openseed");
export const CREATURES_DIR = path.join(OPENSEED_HOME, "creatures");
export const GENOMES_DIR = path.join(OPENSEED_HOME, "genomes");

export function creatureDir(name: string): string {
  return path.join(CREATURES_DIR, name);
}

export const BUNDLED_GENOMES_DIR = path.resolve(import.meta.dirname, "..", "..", "genomes");

export function bundledGenomeDir(genome: string): string {
  return path.join(BUNDLED_GENOMES_DIR, genome);
}

export function installedGenomeDir(genome: string): string {
  return path.join(GENOMES_DIR, genome);
}

/**
 * Parse a genome source into a clone URL, local name, and optional subdirectory.
 *   "dreamer"                                  → openseed-dev/genome-dreamer
 *   "someuser/genome-trader"                   → someuser/genome-trader
 *   "someuser/monorepo/genomes/trader"         → sparse checkout someuser/monorepo at genomes/trader
 *   "https://github.com/someuser/cool-mind"    → full URL used directly
 */
export function parseGenomeSource(source: string): { cloneUrl: string; name: string; subdir?: string } {
  if (source.startsWith("https://") || source.startsWith("git@")) {
    const clean = source.replace(/\.git$/, "");
    const name = clean.split("/").pop()!.replace(/^genome-/, "");
    return { cloneUrl: clean + ".git", name };
  }

  const parts = source.split("/");

  // 3+ parts: owner/repo/path/to/genome (subdirectory within a repo)
  if (parts.length >= 3) {
    const owner = parts[0];
    const repo = parts[1];
    const subdir = parts.slice(2).join("/");
    const name = parts[parts.length - 1].replace(/^genome-/, "");
    return { cloneUrl: `https://github.com/${owner}/${repo}.git`, name, subdir };
  }

  // 2 parts: owner/repo (whole repo is the genome)
  if (parts.length === 2) {
    const name = parts[1].replace(/^genome-/, "");
    return { cloneUrl: `https://github.com/${source}.git`, name };
  }

  // 1 part: shorthand name
  return { cloneUrl: `https://github.com/openseed-dev/genome-${source}.git`, name: source };
}

/** Resolve a genome by name. Checks user-installed, then bundled. */
export function resolveGenomeDir(genome = "dreamer"): string | null {
  const installed = installedGenomeDir(genome);
  if (fs.existsSync(path.join(installed, "genome.json"))) return installed;

  const bundled = bundledGenomeDir(genome);
  if (fs.existsSync(path.join(bundled, "genome.json"))) return bundled;

  return null;
}

/** Write .source.json to record where a genome was cloned from. */
function writeSourceMeta(dir: string, cloneUrl: string, gitDir?: string): void {
  try {
    const sha = execSync("git rev-parse HEAD", { cwd: gitDir || dir, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    fs.writeFileSync(path.join(dir, ".source.json"), JSON.stringify({ repo: cloneUrl, sha, installedAt: new Date().toISOString() }, null, 2) + "\n");
  } catch {}
}

/** Read .source.json from a genome directory, if present. */
export function readSourceMeta(dir: string): { repo: string; sha: string } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, ".source.json"), "utf-8"));
  } catch {
    return null;
  }
}

/** Try to auto-install a genome from GitHub. Returns the installed path or null. */
export function autoInstallGenome(genome: string): string | null {
  validateGenomeSource(genome);
  const { cloneUrl, name, subdir } = parseGenomeSource(genome);
  const dest = installedGenomeDir(name);

  console.log(`genome "${genome}" not found locally, installing from ${cloneUrl}${subdir ? ` (subdir: ${subdir})` : ""}...`);
  try {
    fs.mkdirSync(GENOMES_DIR, { recursive: true });

    if (subdir) {
      const tmpDir = dest + ".tmp";
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      execFileSync("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", cloneUrl, tmpDir], { stdio: "pipe" });
      execFileSync("git", ["sparse-checkout", "set", subdir], { cwd: tmpDir, stdio: "pipe" });
      const extracted = path.join(tmpDir, subdir);
      if (!fs.existsSync(path.join(extracted, "genome.json"))) {
        throw new Error(`no genome.json found at ${subdir}`);
      }
      fs.renameSync(extracted, dest);
      writeSourceMeta(dest, cloneUrl, tmpDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } else {
      execFileSync("git", ["clone", "--depth", "1", cloneUrl, dest], { stdio: "pipe" });
      writeSourceMeta(dest, cloneUrl);
    }

    console.log(`installed genome "${name}" to ${dest}`);
    return dest;
  } catch (err) {
    console.error(`failed to install genome from ${cloneUrl}: ${err instanceof Error ? err.message : String(err)}`);
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(dest + ".tmp", { recursive: true, force: true }); } catch {}
    return null;
  }
}

/** Full resolution: installed → bundled → auto-install from GitHub. Returns path or null. */
export function requireGenomeDir(genome = "dreamer"): string | null {
  validateGenomeSource(genome);
  const dir = resolveGenomeDir(genome);
  if (dir) return dir;
  return autoInstallGenome(genome);
}

export const BOARD_DIR = path.join(OPENSEED_HOME, "board");
