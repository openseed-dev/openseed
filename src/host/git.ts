import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const SHA_RE = /^[0-9a-f]{7,64}$/i;

export function getCurrentSHA(cwd: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8", cwd }).trim();
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
  if (!SHA_RE.test(sha)) {
    throw new Error(`Invalid SHA: ${sha}`);
  }
  execFileSync("git", ["reset", "--hard", sha], { stdio: "inherit", cwd });
}
