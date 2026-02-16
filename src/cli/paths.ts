import os from 'node:os';
import path from 'node:path';

export const ITSALIVE_HOME = process.env.ITSALIVE_HOME || path.join(os.homedir(), ".itsalive");
export const CREATURES_DIR = path.join(ITSALIVE_HOME, "creatures");

export function creatureDir(name: string): string {
  return path.join(CREATURES_DIR, name);
}

export function genomeDir(genome = "dreamer"): string {
  return path.resolve(import.meta.dirname, "..", "..", "genomes", genome);
}
