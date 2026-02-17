import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
 * Parse a genome source into a clone URL and local name.
 *   "dreamer"                                → openseed-dev/genome-dreamer
 *   "someuser/genome-trader"                 → someuser/genome-trader
 *   "https://github.com/someuser/cool-mind"  → full URL used directly
 */
export function parseGenomeSource(source: string): { cloneUrl: string; name: string } {
  if (source.startsWith("https://") || source.startsWith("git@")) {
    const clean = source.replace(/\.git$/, "");
    const name = clean.split("/").pop()!.replace(/^genome-/, "");
    return { cloneUrl: clean + ".git", name };
  }
  if (source.includes("/")) {
    const name = source.split("/").pop()!.replace(/^genome-/, "");
    return { cloneUrl: `https://github.com/${source}.git`, name };
  }
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

/** Try to auto-install a genome from GitHub. Returns the installed path or null. */
export function autoInstallGenome(genome: string): string | null {
  const { cloneUrl, name } = parseGenomeSource(genome);
  const dest = installedGenomeDir(name);

  console.log(`genome "${genome}" not found locally, installing from ${cloneUrl}...`);
  try {
    fs.mkdirSync(GENOMES_DIR, { recursive: true });
    execSync(`git clone --depth 1 ${cloneUrl} ${dest}`, { stdio: "pipe" });
    console.log(`installed genome "${name}" to ${dest}`);
    return dest;
  } catch {
    console.error(`failed to clone ${cloneUrl}`);
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch {}
    return null;
  }
}

/** Full resolution: installed → bundled → auto-install from GitHub. Returns path or null. */
export function requireGenomeDir(genome = "dreamer"): string | null {
  const dir = resolveGenomeDir(genome);
  if (dir) return dir;
  return autoInstallGenome(genome);
}
