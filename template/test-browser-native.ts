// Test using Playwright's native launch (no CDP) to see if Twitter accepts it
import { chromium } from 'playwright';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function test() {
  console.log("Launching browser natively (no CDP)...");
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });

  const page = await context.newPage();

  // Remove webdriver flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  console.log("Going to x.com...");
  await page.goto("https://x.com");
  await sleep(2000);

  console.log("Going to login...");
  await page.goto("https://x.com/i/flow/login");
  await page.waitForSelector('input[name="text"]', { timeout: 15000 });
  await sleep(1000);

  console.log("Typing username...");
  await page.locator('input[name="text"]').pressSequentially("janeesecure", { delay: 80 });
  await sleep(1500);

  console.log("Clicking Next...");
  await page.locator('[role="button"]:has-text("Next")').click();
  await sleep(3000);

  // Snapshot
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || "");
  console.log("Page text:", text);

  // Check for password field
  const hasPwd = await page.locator('input[name="password"]').isVisible().catch(() => false);
  console.log("Password field visible:", hasPwd);

  if (hasPwd) {
    console.log("Typing password...");
    await page.locator('input[name="password"]').pressSequentially("kumcyg-tabzy7-zyDzez", { delay: 60 });
    await sleep(1000);

    console.log("Clicking Log in...");
    await page.locator('[data-testid="LoginForm_Login_Button"]').click();
    await sleep(5000);

    const finalText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || "");
    console.log("Final page:", finalText);
    console.log("URL:", page.url());
  } else {
    // Maybe there's a username verification step
    const hasVerify = await page.locator('input[data-testid="ocfEnterTextTextInput"]').isVisible().catch(() => false);
    console.log("Username verification visible:", hasVerify);

    if (hasVerify) {
      console.log("Entering verification...");
      await page.locator('input[data-testid="ocfEnterTextTextInput"]').pressSequentially("janeesecure", { delay: 80 });
      await sleep(1000);
      await page.locator('[data-testid="ocfEnterTextNextButton"]').click();
      await sleep(3000);

      const hasPwd2 = await page.locator('input[name="password"]').isVisible().catch(() => false);
      if (hasPwd2) {
        await page.locator('input[name="password"]').pressSequentially("kumcyg-tabzy7-zyDzez", { delay: 60 });
        await sleep(1000);
        await page.locator('[data-testid="LoginForm_Login_Button"]').click();
        await sleep(5000);
        console.log("Final URL:", page.url());
        const finalText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || "");
        console.log("Final page:", finalText);
      }
    }
  }

  await browser.close();
  console.log("Done");
}

test().catch(e => { console.error(e); process.exit(1); });
