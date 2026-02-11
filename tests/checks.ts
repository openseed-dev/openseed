import fs from "node:fs/promises";

async function runChecks() {
  console.log("Running checks...");

  // Check 1: version.ts exists and has valid format
  try {
    const content = await fs.readFile("src/shared/version.ts", "utf-8");
    const match = content.match(/export const VERSION = "(.+)";/);

    if (!match) {
      throw new Error("VERSION export not found");
    }

    const version = match[1];
    if (!/^v\d+\.\d+$/.test(version)) {
      throw new Error(`Invalid version format: ${version} (expected vX.Y)`);
    }

    console.log(`✓ Version check passed: ${version}`);
  } catch (err: any) {
    console.error(`✗ Version check failed: ${err.message}`);
    process.exit(1);
  }

  console.log("All checks passed!");
}

runChecks();
