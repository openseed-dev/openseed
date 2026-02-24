import fs from 'node:fs/promises';
import path from 'node:path';

const COPY_SKIP = new Set(["node_modules", ".git", ".sys"]);

export async function copyDir(src: string, dest: string, extraSkip?: Set<string>): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    if (COPY_SKIP.has(entry.name) || extraSkip?.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d, extraSkip);
    else await fs.copyFile(s, d);
  }
}
