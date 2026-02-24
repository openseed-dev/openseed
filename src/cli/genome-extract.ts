import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  creatureDir,
  GENOMES_DIR,
  installedGenomeDir,
} from '../shared/paths.js';

interface ExtractOptions {
  creature: string;
  name: string;
  output?: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export async function genomeExtract(opts: ExtractOptions): Promise<void> {
  if (!NAME_RE.test(opts.creature)) {
    console.error(`invalid creature name "${opts.creature}" (lowercase alphanumeric + hyphens only)`);
    process.exit(1);
  }

  const srcDir = creatureDir(opts.creature);

  // Verify creature exists
  const birthPath = path.join(srcDir, 'BIRTH.json');
  if (!fs.existsSync(birthPath)) {
    console.error(`creature "${opts.creature}" not found`);
    process.exit(1);
  }

  const birth = JSON.parse(fs.readFileSync(birthPath, 'utf-8'));

  // Determine output directory
  const dest = opts.output || installedGenomeDir(opts.name);
  if (fs.existsSync(dest)) {
    console.error(`output directory already exists: ${dest}`);
    console.error(`remove it first or choose a different name`);
    process.exit(1);
  }

  console.log(`extracting genome from creature "${opts.creature}"...`);
  console.log(`  source genome: ${birth.genome || 'unknown'} ${birth.genome_version ? `v${birth.genome_version}` : ''}`);

  // Count self-modification commits
  let commitCount = 0;
  try {
    const log = execSync('git log --oneline', { cwd: srcDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    commitCount = log.trim().split('\n').length;
  } catch {}
  if (commitCount > 1) {
    console.log(`  history: ${commitCount} commits`);
  }

  // Get all git-tracked files
  let trackedFiles: string[];
  try {
    const raw = execSync('git ls-files', { cwd: srcDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    trackedFiles = raw.trim().split('\n').filter(Boolean);
  } catch {
    console.error(`failed to read git-tracked files from "${srcDir}"`);
    process.exit(1);
  }

  // Copy tracked files, skipping BIRTH.json
  fs.mkdirSync(opts.output ? dest : GENOMES_DIR, { recursive: true });
  fs.mkdirSync(dest, { recursive: true });

  for (const file of trackedFiles) {
    if (file === 'BIRTH.json') continue;

    const srcPath = path.join(srcDir, file);
    const destPath = path.join(dest, file);

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }

  // Rewrite genome.json with new name and lineage
  const genomePath = path.join(dest, 'genome.json');
  let genome: any = {};
  try {
    genome = JSON.parse(fs.readFileSync(genomePath, 'utf-8'));
  } catch {}

  const extractSha = (() => {
    try {
      return execSync('git rev-parse HEAD', { cwd: srcDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    } catch { return null; }
  })();

  genome.name = opts.name;
  genome.version = '1.0.0';
  genome.lineage = {
    parent_genome: birth.genome || null,
    parent_version: birth.genome_version || null,
    extracted_from: opts.creature,
    creature_id: birth.id,
    ...(extractSha ? { extracted_at_sha: extractSha } : {}),
  };

  fs.writeFileSync(genomePath, JSON.stringify(genome, null, 2) + '\n');

  // Init fresh git repo
  execSync('git init', { cwd: dest, stdio: 'ignore' });
  execSync('git add -A', { cwd: dest, stdio: 'ignore' });
  execSync(`git commit -m "extracted from creature ${opts.creature}"`, { cwd: dest, stdio: 'ignore' });

  // Show the diff between birth genome and extracted code
  const birthGenome = birth.genome || 'dreamer';
  let diffOutput = '';
  try {
    // Try to find the original genome to diff against
    const { BUNDLED_GENOMES_DIR } = await import('../shared/paths.js');
    const originalDir = path.join(BUNDLED_GENOMES_DIR, birthGenome);
    if (fs.existsSync(originalDir)) {
      diffOutput = execSync(`diff -rq "${originalDir}" "${dest}" --exclude=.git --exclude=node_modules --exclude=.source.json`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    }
  } catch (e) {
    // diff returns exit code 1 when files differ, which is expected
    if (e != null && typeof e === 'object' && 'stdout' in e) diffOutput = String((e as { stdout: unknown }).stdout);
  }

  if (diffOutput.trim()) {
    console.log(`\nchanges from ${birthGenome} genome:`);
    for (const line of diffOutput.trim().split('\n')) {
      console.log(`  ${line}`);
    }
  }

  // Security warning
  console.log(`\n  ⚠  Review before publishing. The creature may have included API keys,`);
  console.log(`     internal data, or sensitive information in its self-modifications.`);

  console.log(`\nextracted genome "${opts.name}" to ${dest}`);
  console.log(`  spawn with: seed spawn test --genome ${opts.name}`);

  console.log(`\nto publish:`);
  console.log(`  cd ${dest}`);
  console.log(`  gh repo create yourname/genome-${opts.name} --public --source .`);
  console.log(`  git push -u origin main`);
  console.log(`  # add the "openseed-genome" topic on GitHub`);
}
