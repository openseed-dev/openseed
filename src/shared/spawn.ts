import {
  exec,
  execSync,
} from 'node:child_process';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { copyDir } from './fs.js';
import {
  CREATURES_DIR,
  readSourceMeta,
  requireGenomeDir,
} from './paths.js';

const execAsync = promisify(exec);

export interface SpawnOptions {
  name: string;
  purpose?: string;
  genome?: string;
  model?: string;
}

export interface SpawnResult {
  id: string;
  name: string;
  born: string;
  genome: string;
  genome_version: string;
  dir: string;
}

function readGenomeVersion(genomePath: string): string {
  try {
    const gj = JSON.parse(readFileSync(path.join(genomePath, 'genome.json'), 'utf-8'));
    return gj.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function checkRequires(genomePath: string): void {
  try {
    const gj = JSON.parse(readFileSync(path.join(genomePath, 'genome.json'), 'utf-8'));
    if (!gj.requires?.openseed) return;
    const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '..', '..', 'package.json'), 'utf-8'));
    const current = pkg.version || '0.0.0';
    const constraint = gj.requires.openseed.replace(/^>=?\s*/, '');
    const [cMaj, cMin = 0, cPat = 0] = constraint.split('.').map(Number);
    const [maj, min = 0, pat = 0] = current.split('.').map(Number);
    const ok = maj > cMaj || (maj === cMaj && (min > cMin || (min === cMin && pat >= cPat)));
    if (!ok) {
      console.warn(`warning: genome "${gj.name}" requires openseed >=${constraint} (you have ${current})`);
    }
  } catch {}
}

function isDockerAvailable(): boolean {
  try { execSync('docker info', { stdio: 'ignore' }); return true; } catch { return false; }
}

/**
 * Core spawn logic used by both CLI and orchestrator.
 * Resolves the genome, copies it, writes the birth certificate,
 * installs deps, inits git, and builds the Docker image.
 */
export async function spawnCreature(opts: SpawnOptions): Promise<SpawnResult> {
  const genomeName = opts.genome || 'dreamer';
  const tpl = requireGenomeDir(genomeName);
  if (!tpl) throw new Error(`genome "${genomeName}" not found (checked ~/.openseed/genomes/ and bundled genomes)`);

  checkRequires(tpl);

  const dir = path.join(CREATURES_DIR, opts.name);

  try {
    await fs.access(dir);
    throw new Error(`creature "${opts.name}" already exists at ${dir}`);
  } catch (e: any) {
    if (e.message.includes('already exists')) throw e;
  }

  await fs.mkdir(CREATURES_DIR, { recursive: true });
  await copyDir(tpl, dir);

  const sourceMeta = readSourceMeta(tpl);
  const birth = {
    id: crypto.randomUUID(),
    name: opts.name,
    born: new Date().toISOString(),
    genome: genomeName,
    genome_version: readGenomeVersion(tpl),
    ...(sourceMeta ? { genome_repo: sourceMeta.repo, genome_sha: sourceMeta.sha } : {}),
    parent: null as string | null,
    ...(opts.model ? { model: opts.model } : {}),
  };
  await fs.writeFile(path.join(dir, 'BIRTH.json'), JSON.stringify(birth, null, 2) + '\n');

  if (opts.purpose) {
    await fs.writeFile(path.join(dir, 'PURPOSE.md'), `# Purpose\n\n${opts.purpose}\n`);
  }

  console.log(`installing dependencies for "${opts.name}"...`);
  await execAsync('pnpm install --silent', { cwd: dir });

  await execAsync('git init', { cwd: dir });
  await execAsync('git add -A', { cwd: dir });
  await execAsync('git commit -m "genesis"', { cwd: dir });

  if (!isDockerAvailable()) throw new Error('docker is required but not available');
  console.log(`building docker image for "${opts.name}"...`);
  await execAsync(`docker build -t creature-${opts.name} .`, { cwd: dir, maxBuffer: 10 * 1024 * 1024 });

  return {
    id: birth.id,
    name: birth.name,
    born: birth.born,
    genome: birth.genome,
    genome_version: birth.genome_version,
    dir,
  };
}
