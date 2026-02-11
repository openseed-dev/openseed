import { execSync } from "node:child_process";
import fs from "node:fs/promises";

async function testRollback() {
  console.log("Testing rollback behavior...");

  // Clean state
  try {
    execSync("rm -rf .self self", { stdio: "pipe" });
  } catch {}

  // Start host in background
  const host = execSync("pnpm dev:host:manual > /tmp/itsalive-test.log 2>&1 & echo $!", {
    encoding: "utf-8",
  }).trim();
  console.log(`Started host (PID: ${host})`);

  try {
    // Wait for boot
    await sleep(3000);

    // First iteration should succeed
    console.log("Triggering first iteration...");
    await fetch("http://localhost:7778/tick", { method: "POST" });
    await sleep(15000);

    const status1 = await (await fetch("http://localhost:7777/status")).json();
    console.log(`After iteration 1: healthy=${status1.healthy}`);

    // Second iteration should succeed
    console.log("Triggering second iteration...");
    await fetch("http://localhost:7778/tick", { method: "POST" });
    await sleep(15000);

    const lastGoodBeforeFail = status1.current_sha;

    // Third iteration should fail and trigger rollback
    console.log("Triggering third iteration (should fail)...");
    try {
      await fetch("http://localhost:7778/tick", { method: "POST" });
    } catch {
      // Expected to fail
    }
    await sleep(5000);

    const status2 = await (await fetch("http://localhost:7777/status")).json();
    console.log(`After rollback: current=${status2.current_sha.slice(0, 7)}`);

    // Verify rollback occurred
    const events = await fs.readFile(".self/events.jsonl", "utf-8");
    const hasRollback = events.includes('"type":"host.rollback"');

    if (!hasRollback) {
      throw new Error("No rollback event found");
    }

    // Verify version was restored
    const version = await fs.readFile("src/shared/version.ts", "utf-8");
    if (!version.includes('VERSION = "v0.1"')) {
      throw new Error("Version was not restored after rollback");
    }

    console.log("✓ Rollback test passed!");
    process.exit(0);
  } catch (err: any) {
    console.error(`✗ Rollback test failed: ${err.message}`);
    process.exit(1);
  } finally {
    // Cleanup
    execSync(`kill ${host}`, { stdio: "ignore" });
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

testRollback();
