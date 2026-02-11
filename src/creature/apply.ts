import { execSync } from "node:child_process";

export async function runChecks(): Promise<{ ok: boolean; ms: number; out_tail?: string }> {
  const start = Date.now();
  try {
    const output = execSync("pnpm -s test", { encoding: "utf-8", stdio: "pipe" });
    return { ok: true, ms: Date.now() - start, out_tail: output.slice(-200) };
  } catch (err: any) {
    return { ok: false, ms: Date.now() - start, out_tail: err.stdout?.slice(-200) || err.message };
  }
}

export function gitCommit(message: string): string {
  execSync("git add -A", { stdio: "inherit" });
  execSync(`git commit -m "${message}"`, { stdio: "inherit" });
  const sha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  return sha;
}
