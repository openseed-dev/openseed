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

function writeSourceJson(dir: string, repo: string, sha: string): void {
  fs.writeFileSync(path.join(dir, '.source.json'), JSON.stringify({ repo, sha, installedAt: new Date().toISOString() }, null, 2) + '\n');
}

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
  const { cloneUrl, name, subdir } = parseGenomeSource(source);
  const dest = installedGenomeDir(name);

  if (fs.existsSync(path.join(dest, 'genome.json'))) {
    console.error(`genome "${name}" is already installed at ${dest}`);
    console.error(`run "seed genome remove ${name}" first to reinstall`);
    process.exit(1);
  }

  console.log(`cloning ${cloneUrl}${subdir ? ` (subdir: ${subdir})` : ''}...`);
  fs.mkdirSync(GENOMES_DIR, { recursive: true });

  try {
    if (subdir) {
      const tmpDir = dest + '.tmp';
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      execSync(`git clone --depth 1 --filter=blob:none --sparse ${cloneUrl} ${tmpDir}`, { stdio: 'inherit' });
      execSync(`git sparse-checkout set ${subdir}`, { cwd: tmpDir, stdio: 'inherit' });
      const sha = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf-8' }).trim();
      const extracted = path.join(tmpDir, subdir);
      fs.renameSync(extracted, dest);
      writeSourceJson(dest, cloneUrl, sha);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } else {
      execSync(`git clone --depth 1 ${cloneUrl} ${dest}`, { stdio: 'inherit' });
      const sha = execSync('git rev-parse HEAD', { cwd: dest, encoding: 'utf-8' }).trim();
      writeSourceJson(dest, cloneUrl, sha);
    }
  } catch {
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(dest + '.tmp', { recursive: true, force: true }); } catch {}
    console.error(`failed to clone ${cloneUrl}`);
    process.exit(1);
  }

  const meta = readGenomeMeta(dest);
  if (!meta) {
    console.error(`cloned repo has no genome.json, not a valid genome`);
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

export async function genomeSearch(query: string): Promise<void> {
  const q = encodeURIComponent(`topic:openseed-genome ${query}`);
  const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=20`;

  let data: any;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'openseed-cli' } });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    data = await res.json();
  } catch (err: any) {
    console.error(`search failed: ${err.message}`);
    process.exit(1);
  }

  if (!data.items?.length) {
    console.log(`no genomes found for "${query}"`);
    return;
  }

  // Fetch genome.json from each repo for richer metadata
  const rows: Array<{ name: string; version: string; repo: string; description: string }> = [];
  for (const item of data.items) {
    let gName = item.name.replace(/^genome-/, '');
    let version = '?';
    try {
      const raw = await fetch(`https://raw.githubusercontent.com/${item.full_name}/${item.default_branch}/genome.json`, { headers: { 'User-Agent': 'openseed-cli' } });
      if (raw.ok) {
        const gj = await raw.json();
        if (gj.name) gName = gj.name;
        if (gj.version) version = gj.version;
      }
    } catch {}
    rows.push({ name: gName, version, repo: item.full_name, description: item.description || '' });
  }

  const nameW = Math.max(6, ...rows.map(r => r.name.length));
  const verW = Math.max(7, ...rows.map(r => r.version.length));
  const repoW = Math.max(4, ...rows.map(r => r.repo.length));

  console.log(`${'name'.padEnd(nameW)}  ${'version'.padEnd(verW)}  ${'repo'.padEnd(repoW)}  description`);
  console.log(`${'─'.repeat(nameW)}  ${'─'.repeat(verW)}  ${'─'.repeat(repoW)}  ${'─'.repeat(30)}`);
  for (const r of rows) {
    console.log(`${r.name.padEnd(nameW)}  ${r.version.padEnd(verW)}  ${r.repo.padEnd(repoW)}  ${r.description}`);
  }

  console.log(`\ninstall with: seed genome install <repo>`);
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
