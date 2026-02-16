import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  BUNDLED_GENOMES_DIR,
  bundledGenomeDir,
  GENOMES_DIR,
  installedGenomeDir,
  parseGenomeSource,
} from '../shared/paths.js';

interface GenomeMeta {
  name: string;
  version?: string;
  description?: string;
}

function readGenomeMeta(dir: string): GenomeMeta | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'genome.json'), 'utf-8'));
  } catch {
    return null;
  }
}

export async function genomeInstall(source: string): Promise<void> {
  const { cloneUrl, name } = parseGenomeSource(source);
  const dest = installedGenomeDir(name);

  if (fs.existsSync(path.join(dest, 'genome.json'))) {
    console.error(`genome "${name}" is already installed at ${dest}`);
    console.error(`run "seed genome remove ${name}" first to reinstall`);
    process.exit(1);
  }

  console.log(`cloning ${cloneUrl}...`);
  fs.mkdirSync(GENOMES_DIR, { recursive: true });

  try {
    execSync(`git clone --depth 1 ${cloneUrl} ${dest}`, { stdio: 'inherit' });
  } catch {
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch {}
    console.error(`failed to clone ${cloneUrl}`);
    process.exit(1);
  }

  const meta = readGenomeMeta(dest);
  if (!meta) {
    console.error(`cloned repo has no genome.json — not a valid genome`);
    fs.rmSync(dest, { recursive: true, force: true });
    process.exit(1);
  }

  console.log(`installed genome "${meta.name || name}" (${meta.version || '?'}) to ${dest}`);
}

export async function genomeList(): Promise<void> {
  const seen = new Set<string>();
  const rows: Array<{ name: string; version: string; description: string; source: string }> = [];

  if (fs.existsSync(GENOMES_DIR)) {
    for (const entry of fs.readdirSync(GENOMES_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const meta = readGenomeMeta(path.join(GENOMES_DIR, entry.name));
      if (!meta) continue;
      seen.add(entry.name);
      rows.push({
        name: meta.name || entry.name,
        version: meta.version || '?',
        description: meta.description || '',
        source: 'installed',
      });
    }
  }

  const bundledRoot = BUNDLED_GENOMES_DIR;
  if (fs.existsSync(bundledRoot)) {
    for (const entry of fs.readdirSync(bundledRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue;
      const meta = readGenomeMeta(path.join(bundledRoot, entry.name));
      if (!meta) continue;
      rows.push({
        name: meta.name || entry.name,
        version: meta.version || '?',
        description: meta.description || '',
        source: 'bundled',
      });
    }
  }

  if (rows.length === 0) {
    console.log('no genomes found');
    return;
  }

  const nameW = Math.max(6, ...rows.map(r => r.name.length));
  const verW = Math.max(7, ...rows.map(r => r.version.length));
  const srcW = Math.max(6, ...rows.map(r => r.source.length));

  console.log(`${'name'.padEnd(nameW)}  ${'version'.padEnd(verW)}  ${'source'.padEnd(srcW)}  description`);
  console.log(`${'─'.repeat(nameW)}  ${'─'.repeat(verW)}  ${'─'.repeat(srcW)}  ${'─'.repeat(30)}`);
  for (const r of rows) {
    console.log(`${r.name.padEnd(nameW)}  ${r.version.padEnd(verW)}  ${r.source.padEnd(srcW)}  ${r.description}`);
  }
}

export async function genomeRemove(name: string): Promise<void> {
  const dir = installedGenomeDir(name);

  if (!fs.existsSync(dir)) {
    const bundled = bundledGenomeDir(name);
    if (fs.existsSync(bundled)) {
      console.error(`"${name}" is a bundled genome and can't be removed`);
    } else {
      console.error(`genome "${name}" is not installed`);
    }
    process.exit(1);
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`removed genome "${name}"`);
}
