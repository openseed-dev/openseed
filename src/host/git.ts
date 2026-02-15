import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export function getCurrentSHA(cwd: string): string {
  return execSync("git rev-parse HEAD", { encoding: "utf-8", cwd }).trim();
}

export async function getLastGoodSHA(cwd: string): Promise<string> {
  const file = path.join(cwd, ".sys", "last_good.txt");
  try {
    const sha = await fs.readFile(file, "utf-8");
    return sha.trim();
  } catch {
    return getCurrentSHA(cwd);
  }
}

export async function setLastGoodSHA(cwd: string, sha: string) {
  const file = path.join(cwd, ".sys", "last_good.txt");
  await fs.writeFile(file, sha, "utf-8");
}

export function resetToSHA(cwd: string, sha: string) {
  execSync(`git reset --hard ${sha}`, { stdio: "inherit", cwd });
}
