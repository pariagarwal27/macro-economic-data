import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { isoToPickerDate } from "./investing-date-format";

export const PROFILE_DIR = path.join(process.cwd(), ".playwright-investing-profile");
const SINGLETON_FILES = ["SingletonLock", "SingletonCookie", "SingletonSocket"] as const;

/** Slower than SmartBuy — Investing Cloudflare is touchy. */
const HUMAN_PAUSE_MIN_MS = 2500;
const HUMAN_PAUSE_MAX_MS = 5000;

const STEALTH_INIT = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  Object.defineProperty(navigator, "plugins", {
    get: () => [{ name: "Chrome PDF Plugin" }, { name: "Chrome PDF Viewer" }],
  });
  // @ts-expect-error chrome stub
  window.chrome = { runtime: {} };
};

export function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) flags.add(arg);
    else positional.push(arg);
  }
  return { flags, positional };
}

export function clearProfileDir(profileDir = PROFILE_DIR) {
  if (fs.existsSync(profileDir)) {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

export function healProfileLock(profileDir = PROFILE_DIR) {
  try {
    execSync(`pkill -f "user-data-dir=${profileDir}"`, { stdio: "ignore" });
  } catch {
    /* none running */
  }
  for (const name of SINGLETON_FILES) {
    const p = path.join(profileDir, name);
    try {
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
}

export async function humanPause(page: Page, minMs = HUMAN_PAUSE_MIN_MS, maxMs = HUMAN_PAUSE_MAX_MS) {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
  await page.waitForTimeout(ms);
}

export async function humanMouseJitter(page: Page) {
  const vp = page.viewportSize() ?? { width: 1400, height: 900 };
  const moves = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < moves; i++) {
    const x = 120 + Math.floor(Math.random() * (vp.width - 240));
    const y = 120 + Math.floor(Math.random() * (vp.height - 240));
    await page.mouse.move(x, y, { steps: 8 + Math.floor(Math.random() * 14) });
    await page.waitForTimeout(200 + Math.floor(Math.random() * 400));
  }
}

export async function humanScroll(page: Page) {
  const delta = 80 + Math.floor(Math.random() * 220);
  await page.mouse.wheel(0, delta);
  await page.waitForTimeout(800 + Math.floor(Math.random() * 1200));
  if (Math.random() > 0.5) {
    await page.mouse.wheel(0, -(40 + Math.floor(Math.random() * 100)));
    await page.waitForTimeout(500 + Math.floor(Math.random() * 800));
  }
}

export async function humanClickLocator(page: Page, loc: Locator) {
  await loc.waitFor({ state: "visible", timeout: 20000 });
  const box = await loc.boundingBox();
  if (!box) {
    await loc.click({ timeout: 8000 });
    return;
  }
  const cx = box.x + box.width / 2 + (Math.random() * 6 - 3);
  const cy = box.y + box.height / 2 + (Math.random() * 4 - 2);
  await page.mouse.move(cx - 35, cy - 10, { steps: 8 });
  await page.waitForTimeout(150 + Math.floor(Math.random() * 250));
  await page.mouse.move(cx, cy, { steps: 6 });
  await page.waitForTimeout(100 + Math.floor(Math.random() * 200));
  await page.mouse.click(cx, cy);
}

async function isCloudflareChallenge(page: Page): Promise<boolean> {
  const title = (await page.title()).toLowerCase();
  if (/just a moment|verify you are human|checking your browser|attention required/.test(title)) {
    return true;
  }
  const cfFrame = page.locator('iframe[src*="challenges.cloudflare"], iframe[title*="Cloudflare"]');
  if (await cfFrame.count()) return true;
  const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  return /verify you are human|checking if the site connection is secure|performing security verification/.test(
    body
  );
}

async function hasCalendarTable(page: Page): Promise<boolean> {
  return (await page.locator("table[class*=datatable]").count()) > 0;
}

export async function waitForCalendarReady(page: Page, maxMs = 900_000): Promise<boolean> {
  const start = Date.now();
  let warned = false;

  while (Date.now() - start < maxMs) {
    if (page.isClosed()) return false;
    if (await hasCalendarTable(page)) {
      await humanPause(page, 2000, 4000);
      return true;
    }

    const onChallenge = await isCloudflareChallenge(page);
    if (onChallenge || Date.now() - start > 12_000) {
      if (!warned) {
        console.log(
          "Cloudflare check — click the checkbox in the browser if shown. Do not close the window. Waiting up to 15 min…"
        );
        warned = true;
      }
      // During challenge: slow idle only — aggressive mouse can re-trigger checks
      if (!onChallenge) {
        await humanMouseJitter(page).catch(() => {});
        if (Math.random() > 0.6) await humanScroll(page).catch(() => {});
      }
    }

    await page.waitForTimeout(4000 + Math.floor(Math.random() * 3000));
  }

  if (page.isClosed()) return false;
  return hasCalendarTable(page);
}

export async function dismissConsent(page: Page) {
  await page.keyboard.press("Escape").catch(() => {});
  await humanPause(page, 800, 1500);
  for (const label of ["Accept All", "I Agree", "Accept", "Not now", "Maybe later"]) {
    const btn = page.getByRole("button", { name: new RegExp(label, "i") });
    if (await btn.count()) {
      await humanClickLocator(page, btn.first());
      await humanPause(page, 1200, 2200);
      break;
    }
  }
}

export async function launchInvestingContext(options?: {
  fresh?: boolean;
  profileDir?: string;
}): Promise<{ context: BrowserContext; page: Page }> {
  const cdpUrl = process.env.INVESTING_CDP_URL;
  if (cdpUrl) {
    console.log(`Connecting to Chrome via CDP (${cdpUrl})…`);
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return { context, page };
  }

  const profileDir = options?.profileDir ?? PROFILE_DIR;

  if (options?.fresh) {
    clearProfileDir(profileDir);
  } else {
    healProfileLock(profileDir);
  }

  fs.mkdirSync(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: "chrome",
    slowMo: 80,
    locale: "en-US",
    timezoneId: "Europe/London",
    viewport: { width: 1400, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  await context.addInitScript(STEALTH_INIT);

  const page = context.pages()[0] ?? (await context.newPage());

  // Let the browser settle before any navigation (reduces instant-bot fingerprint)
  await page.waitForTimeout(3000 + Math.floor(Math.random() * 4000));

  return { context, page };
}

/** Homepage warm-up → calendar via link click (matches manual Jul'25 backfill). */
export async function applyCustomDates(page: Page, from: string, to: string) {
  await dismissConsent(page);
  await humanPause(page, 1500, 2500);

  const customBtn = page.getByRole("button", { name: /Custom dates/i });
  if (!(await customBtn.count())) {
    throw new Error("Custom dates button not found on calendar page");
  }
  await humanClickLocator(page, customBtn.first());
  await humanPause(page, 2000, 3500);

  const start = page.locator("#date-picker-start-day");
  const end = page.locator("#date-picker-end-day");
  await start.waitFor({ state: "visible", timeout: 45000 });

  const fromPicker = isoToPickerDate(from);
  const toPicker = isoToPickerDate(to);

  await start.click();
  await humanPause(page, 400, 900);
  await start.fill(fromPicker);
  await humanPause(page, 800, 1500);

  await end.click();
  await humanPause(page, 400, 900);
  await end.fill(toPicker);
  await humanPause(page, 1000, 2000);

  const apply = page.locator('[data-test="date-picker-apply"], button:has-text("Apply")').first();
  await humanClickLocator(page, apply);
  await humanPause(page, 7000, 11_000);
}

export async function warmCalendarPage(page: Page) {
  console.log("Warming up: homepage first, then calendar (~20–30s)…");

  await page.goto("https://www.investing.com/", {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await humanPause(page, 5000, 9000);
  await humanMouseJitter(page);
  await humanScroll(page);
  await humanPause(page, 3000, 6000);

  // Homepage dwell is the warm-up; nav link is often hidden in a dropdown
  await page.goto("https://www.investing.com/economic-calendar/", {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });

  await humanPause(page, 6000, 10_000);
  await humanScroll(page);
  await humanPause(page, 2000, 4000);

  const ready = await waitForCalendarReady(page);
  if (!ready) {
    throw new Error("Calendar did not load — pass Cloudflare in the browser, then re-run (omit --fresh)");
  }

  await dismissConsent(page);
  await humanPause(page, 2000, 3500);
}
