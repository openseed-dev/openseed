// Test using the actual installed Chrome (not Playwright's Chromium)
import { chromium } from 'playwright';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function test() {
  console.log("Launching installed Chrome (channel: chrome)...");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });

  const page = await context.newPage();
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
  await page.locator('input[name="text"]').pressSequentially("janeesecure", { delay: 100 });
  await sleep(2000);

  console.log("Clicking Next...");
  await page.locator('[role="button"]:has-text("Next")').click();
  await sleep(4000);

  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || "");
  console.log("Page text after Next:", text.slice(0, 500));

  const hasPwd = await page.locator('input[name="password"]').isVisible().catch(() => false);
  console.log("Password field visible:", hasPwd);

  if (hasPwd) {
    console.log("Typing password...");
    await page.locator('input[name="password"]').pressSequentially("kumcyg-tabzy7-zyDzez", { delay: 80 });
    await sleep(1500);

    console.log("Clicking Log in...");
    await page.locator('[data-testid="LoginForm_Login_Button"]').click();
    await sleep(5000);

    console.log("Final URL:", page.url());
    const finalText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || "");
    console.log("Final page:", finalText.slice(0, 500));
  }

  await browser.close();
  console.log("Done");
}

test().catch(e => { console.error(e); process.exit(1); });
