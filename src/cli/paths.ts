import os from 'node:os';
import path from 'node:path';

export const ITSALIVE_HOME = path.join(os.homedir(), ".itsalive");
export const CREATURES_DIR = path.join(ITSALIVE_HOME, "creatures");

export function creatureDir(name: string): string {
  return path.join(CREATURES_DIR, name);
}

export function templateDir(): string {
  // Resolve relative to this file: src/cli/paths.ts -> ../../template
  return path.resolve(import.meta.dirname, "..", "..", "template");
}
