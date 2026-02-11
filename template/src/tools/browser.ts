import {
  Browser,
  BrowserContext,
  chromium,
  Page,
} from 'playwright';

const SNAPSHOT_TEXT_LIMIT = 3000;
const SNAPSHOT_ELEMENTS_LIMIT = 50;

let browser: Browser | null = null;
let defaultPage: Page | null = null;

async function ensureBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;

  // Prefer installed Chrome (passes anti-bot checks far better than Playwright's Chromium)
  // Falls back to Playwright's bundled Chromium if Chrome isn't available
  try {
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    return browser;
  } catch {
    // Chrome not installed — use Playwright's Chromium
  }

  browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  return browser;
}

const REALISTIC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function initPage(page: Page): Promise<void> {
  // Remove automation signals
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    // Override permissions API to look normal
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === "notifications"
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);
  });
}

let managedContext: BrowserContext | null = null;

async function getActivePage(): Promise<Page> {
  const b = await ensureBrowser();

  // Reuse our managed context if it still exists
  if (managedContext && !managedContext.pages().every((p) => p.isClosed())) {
    const pages = managedContext.pages().filter((p) => !p.isClosed());
    if (defaultPage && !defaultPage.isClosed()) return defaultPage;
    defaultPage = pages[0] || await managedContext.newPage();
    await initPage(defaultPage);
    return defaultPage;
  }

  // Create a fresh context with anti-detection settings
  managedContext = await b.newContext({
    userAgent: REALISTIC_UA,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  defaultPage = await managedContext.newPage();
  await initPage(defaultPage);
  return defaultPage;
}

async function getPageSnapshot(page: Page): Promise<string> {
  const url = page.url();
  let title = "";
  try { title = await page.title(); } catch { title = "(unknown)"; }

  let visibleText = "";
  try {
    visibleText = await page.evaluate(() => {
      return document.body?.innerText?.slice(0, 5000) || "";
    });
    if (visibleText.length > SNAPSHOT_TEXT_LIMIT) {
      visibleText = visibleText.slice(0, SNAPSHOT_TEXT_LIMIT) + "\n...(truncated)";
    }
  } catch {
    visibleText = "(could not extract text)";
  }

  let elements = "";
  try {
    const items: string[] = await page.evaluate((limit) => {
      const results: string[] = [];
      const els = document.querySelectorAll(
        'input, button, a, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"]'
      );
      for (let i = 0; i < els.length && results.length < limit; i++) {
        const el = els[i] as HTMLElement;
        if (el.offsetWidth === 0 && el.offsetHeight === 0) continue; // hidden

        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute("type") || "";
        const name = el.getAttribute("name") || "";
        const placeholder = el.getAttribute("placeholder") || "";
        const ariaLabel = el.getAttribute("aria-label") || "";
        const text = el.textContent?.trim().slice(0, 60) || "";
        const value = (el as HTMLInputElement).value || "";
        const label = ariaLabel || placeholder || text || name || type;
        if (!label) continue;

        let desc = `[${results.length}] <${tag}`;
        if (type) desc += ` type="${type}"`;
        if (name) desc += ` name="${name}"`;
        desc += `> "${label}"`;
        if (value && tag === "input") desc += ` value="${value.slice(0, 30)}"`;
        results.push(desc);
      }
      return results;
    }, SNAPSHOT_ELEMENTS_LIMIT);
    elements = items.join("\n");
  } catch {
    elements = "(could not extract elements)";
  }

  return `URL: ${url}\nTitle: ${title}\n\n=== Visible Text ===\n${visibleText}\n\n=== Interactive Elements ===\n${elements}`;
}

export interface BrowserResult {
  ok: boolean;
  snapshot?: string;
  error?: string;
  data?: unknown;
}

export async function executeBrowser(
  action: string,
  params: Record<string, unknown>
): Promise<BrowserResult> {
  try {
    switch (action) {
      case "goto": {
        const url = params.url as string;
        if (!url) return { ok: false, error: "url is required" };
        const page = await getActivePage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        // Brief wait for dynamic content
        await page.waitForTimeout(1000);
        return { ok: true, snapshot: await getPageSnapshot(page) };
      }

      case "click": {
        const selector = params.selector as string;
        if (!selector) return { ok: false, error: "selector is required" };
        const page = await getActivePage();
        await page.click(selector, { timeout: 10000 });
        await page.waitForTimeout(1000);
        return { ok: true, snapshot: await getPageSnapshot(page) };
      }

      case "fill": {
        const selector = params.selector as string;
        const text = params.text as string;
        if (!selector || text === undefined) return { ok: false, error: "selector and text are required" };
        const page = await getActivePage();
        await page.fill(selector, text, { timeout: 10000 });
        return { ok: true, snapshot: await getPageSnapshot(page) };
      }

      case "type": {
        const selector = params.selector as string;
        const text = params.text as string;
        if (!selector || text === undefined) return { ok: false, error: "selector and text are required" };
        const page = await getActivePage();
        await page.locator(selector).pressSequentially(text, { delay: 50, timeout: 10000 });
        return { ok: true, snapshot: await getPageSnapshot(page) };
      }

      case "press": {
        const key = params.key as string;
        if (!key) return { ok: false, error: "key is required" };
        const page = await getActivePage();
        await page.keyboard.press(key);
        await page.waitForTimeout(500);
        return { ok: true, snapshot: await getPageSnapshot(page) };
      }

      case "snapshot": {
        const page = await getActivePage();
        return { ok: true, snapshot: await getPageSnapshot(page) };
      }

      case "evaluate": {
        const script = params.script as string;
        if (!script) return { ok: false, error: "script is required" };
        const page = await getActivePage();
        const result = await page.evaluate(script);
        const snapshot = await getPageSnapshot(page);
        return { ok: true, data: result, snapshot };
      }

      case "wait": {
        const selector = params.selector as string;
        const ms = params.ms as number;
        const page = await getActivePage();
        if (selector) {
          await page.waitForSelector(selector, { timeout: ms || 10000 });
        } else if (ms) {
          await page.waitForTimeout(ms);
        }
        return { ok: true, snapshot: await getPageSnapshot(page) };
      }

      case "tabs": {
        const b = await ensureBrowser();
        const allPages = b.contexts().flatMap((c) => c.pages());
        const tabList = allPages.map((p, i) => `[${i}] ${p.url()} — ${p.isClosed() ? "(closed)" : "open"}`);
        return { ok: true, data: tabList.join("\n") };
      }

      case "switch_tab": {
        const index = params.index as number;
        const b = await ensureBrowser();
        const allPages = b.contexts().flatMap((c) => c.pages());
        if (index < 0 || index >= allPages.length) return { ok: false, error: `Tab ${index} not found (${allPages.length} tabs open)` };
        defaultPage = allPages[index];
        return { ok: true, snapshot: await getPageSnapshot(defaultPage) };
      }

      case "new_tab": {
        // Ensure we have a browser & context via getActivePage, then create a new page
        await getActivePage();
        defaultPage = await managedContext!.newPage();
        await initPage(defaultPage);
        const url = params.url as string;
        if (url) {
          await defaultPage.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
          await defaultPage.waitForTimeout(1000);
        }
        return { ok: true, snapshot: await getPageSnapshot(defaultPage) };
      }

      case "close": {
        if (browser?.isConnected()) {
          // Kill all pages, then the browser
          for (const ctx of browser.contexts()) {
            for (const page of ctx.pages()) {
              try { await page.close(); } catch {}
            }
          }
          try { await browser.close(); } catch {}
        }
        browser = null;
        defaultPage = null;
        managedContext = null;
        return { ok: true, data: "Browser closed" };
      }

      default:
        return { ok: false, error: `Unknown action: ${action}. Available: goto, click, fill, type, press, snapshot, evaluate, wait, tabs, switch_tab, new_tab, close` };
    }
  } catch (err) {
    // On connection errors, reset state so next call retries
    if (err instanceof Error && (err.message.includes("Target closed") || err.message.includes("Connection closed"))) {
      browser = null;
      defaultPage = null;
      managedContext = null;
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const browserTool = {
  name: "browser",
  description: `Control a headless Chromium browser. The browser persists between calls — sessions, cookies, and tabs survive.

Actions:
- goto { url } — navigate to URL
- click { selector } — click an element
- fill { selector, text } — clear a field and type text
- type { selector, text } — type text without clearing (for search boxes etc.)
- press { key } — press a keyboard key (Enter, Tab, Escape, etc.)
- snapshot — get current page state without acting
- evaluate { script } — run JavaScript on the page
- wait { selector?, ms? } — wait for an element or a duration
- tabs — list open tabs
- switch_tab { index } — switch to a different tab
- new_tab { url? } — open a new tab
- close — shut down the browser

Every action returns a text snapshot of the page: URL, title, visible text, and interactive elements.

Selectors: Use CSS selectors (input[name="text"]), text selectors (text=Sign in), or Playwright selectors (role=button[name="Next"]).

Example flow:
1. browser({ action: "goto", url: "https://x.com/login" })
2. browser({ action: "fill", selector: "input[name='text']", text: "myuser" })
3. browser({ action: "click", selector: "text=Next" })
4. browser({ action: "fill", selector: "input[name='password']", text: "mypass" })
5. browser({ action: "click", selector: "text=Log in" })`,
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        description: "The browser action to perform",
        enum: ["goto", "click", "fill", "type", "press", "snapshot", "evaluate", "wait", "tabs", "switch_tab", "new_tab", "close"],
      },
      url: { type: "string", description: "URL for goto/new_tab" },
      selector: { type: "string", description: "CSS/text/role selector for click/fill/type/wait" },
      text: { type: "string", description: "Text for fill/type" },
      key: { type: "string", description: "Key name for press (Enter, Tab, Escape, etc.)" },
      script: { type: "string", description: "JavaScript for evaluate" },
      index: { type: "number", description: "Tab index for switch_tab" },
      ms: { type: "number", description: "Milliseconds for wait" },
    },
    required: ["action"],
  },
};
