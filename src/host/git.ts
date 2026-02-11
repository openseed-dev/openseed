import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const LAST_GOOD_FILE = path.join(".self", "last_good.txt");

export function getCurrentSHA(): string {
  return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
}

export async function getLastGoodSHA(): Promise<string> {
  try {
    const sha = await fs.readFile(LAST_GOOD_FILE, "utf-8");
    return sha.trim();
  } catch {
    return getCurrentSHA();
  }
}

export async function setLastGoodSHA(sha: string) {
  await fs.writeFile(LAST_GOOD_FILE, sha, "utf-8");
}

export function resetToSHA(sha: string) {
  execSync(`git reset --hard ${sha}`, { stdio: "inherit" });
}
