import { executeBrowser } from './src/tools/browser.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function test() {
  console.log("=== goto x.com ===");
  let r = await executeBrowser("goto", { url: "https://x.com" });
  console.log("ok:", r.ok);
  await sleep(1000);

  console.log("\n=== goto login ===");
  r = await executeBrowser("goto", { url: "https://x.com/i/flow/login" });
  console.log("ok:", r.ok);

  console.log("\n=== wait for username field ===");
  r = await executeBrowser("wait", { selector: 'input[name="text"]', ms: 10000 });
  console.log("ok:", r.ok);

  console.log("\n=== type username ===");
  r = await executeBrowser("type", { selector: 'input[name="text"]', text: "janeesecure" });
  console.log("ok:", r.ok);
  if (r.snapshot) console.log(r.snapshot.slice(0, 500));
  await sleep(1500);

  console.log("\n=== click Next ===");
  r = await executeBrowser("click", { selector: '[role="button"]:has-text("Next")' });
  console.log("ok:", r.ok);
  if (r.snapshot) console.log(r.snapshot.slice(0, 500));
  await sleep(2000);

  console.log("\n=== wait for password ===");
  r = await executeBrowser("wait", { selector: 'input[name="password"]', ms: 10000 });
  console.log("ok:", r.ok);

  if (r.ok) {
    console.log("\n=== type password ===");
    r = await executeBrowser("type", { selector: 'input[name="password"]', text: "kumcyg-tabzy7-zyDzez" });
    console.log("ok:", r.ok);
    await sleep(1000);

    console.log("\n=== click Log in ===");
    r = await executeBrowser("click", { selector: '[data-testid="LoginForm_Login_Button"]' });
    console.log("ok:", r.ok);
    await sleep(3000);

    console.log("\n=== final snapshot ===");
    r = await executeBrowser("snapshot", {});
    console.log("ok:", r.ok);
    if (r.snapshot) console.log(r.snapshot.slice(0, 1000));
  } else {
    console.log("ERROR:", r.error);
  }

  await executeBrowser("close", {});
  console.log("\n=== Done ===");
}

test().catch(e => { console.error(e); process.exit(1); });
