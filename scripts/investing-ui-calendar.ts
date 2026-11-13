import { load } from "cheerio";
import { chromium, type Page } from "playwright";
import path from "node:path";
import fs from "node:fs";

type ForecastRow = { date: string; time: string; country: string; currency: string | null; event: string; forecast: string | null };
const countries: Record<string, [string, string]> = { US: ["US", "USD"], GB: ["UK", "GBP"], UK: ["UK", "GBP"], EU: ["EA", "EUR"], EA: ["EA", "EUR"], DE: ["DE", "EUR"], FR: ["FR", "EUR"], IT: ["IT", "EUR"], ES: ["ES", "EUR"], AU: ["AU", "AUD"] };

export function parseVisibleForecasts(html: string, date: string): ForecastRow[] {
  const $ = load(html);
  const table = $("table").filter((_, element) => $(element).find("thead th").toArray().some(th => $(th).text().trim() === "Forecast")).first();
  if (!table.length) throw new Error("Calendar table or forecast column is missing");
  const expectedHeader = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric" });
  let seenDate = false;
  const rows: ForecastRow[] = [];
  table.find("tbody tr").each((_, element) => {
    const cells = $(element).children("td");
    if (cells.length === 1) {
      const header = $(cells[0]).text().trim();
      if (header !== expectedHeader) throw new Error(`Unexpected calendar date: ${header}`);
      seenDate = true;
      return;
    }
    if (!$(element).attr("id") || cells.length < 8) return;
    if (!seenDate) throw new Error("Calendar date header is missing");
    const time = $(cells[1]).text().trim();
    const country = countries[$(cells[2]).text().trim().toUpperCase()];
    const event = $(cells[3]).find("a").first().text().trim();
    if (!country || !event || !/^\d{1,2}:\d{2}$/.test(time)) return;
    const forecast = $(cells[6]).text().trim();
    rows.push({ date, time, country: country[0], currency: country[1], event, forecast: forecast || null });
  });
  if (!seenDate) throw new Error("Calendar date header is missing");
  return rows;
}

async function setAll(page: Page, label: string) {
  const field = page.getByText(label, { exact: true }).locator("xpath=../..").locator("div.no-contextual-alternatives");
  await field.click();
  await page.getByRole("button", { name: "Select All", exact: true }).click();
  await page.keyboard.press("Escape");
}

export async function fetchVisibleInvestingDay(date: string) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (date !== today) throw new Error("Collector only supports the current London day");
  const profilePath = path.join(process.cwd(), ".playwright-investing-consensus-profile");
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: true,
    channel: "chrome",
    locale: "en-GB",
    timezoneId: "Europe/London",
    viewport: { width: 1400, height: 900 },
  });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto("https://www.investing.com/economic-calendar/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    const todayButton = page.getByRole("button", { name: "Today", exact: true });
    try { await todayButton.waitFor({ timeout: 30000 }); }
    catch {
      const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 1200);
      const diagnosticPath = path.join(process.cwd(), "tmp", "investing-ui-headless-failure.png");
      fs.mkdirSync(path.dirname(diagnosticPath), { recursive: true });
      await page.screenshot({ path: diagnosticPath, fullPage: true }).catch(() => {});
      throw new Error(`Calendar controls missing (title=${await page.title()}; url=${page.url()}; body=${body}; screenshot=${diagnosticPath})`);
    }
    await page.getByText("Current Time:", { exact: true }).click();
    const londonOption = page.getByText(/Dublin, Edinburgh, Lisbon, London/).last();
    await londonOption.waitFor({ state: "visible", timeout: 10000 });
    await londonOption.evaluate(element => (element as HTMLElement).click());
    await page.getByText("Display Time:", { exact: true }).click();
    await page.getByRole("radio", { name: "Display time only" }).check();
    const showFilters = page.getByRole("button", { name: "Show Filters", exact: true });
    if (await showFilters.isVisible()) await showFilters.click();
    await setAll(page, "Country");
    await setAll(page, "Category");
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.waitForTimeout(3000);
    const more = page.getByRole("button", { name: "Load more", exact: true });
    for (let i = 0; await more.isVisible(); i++) {
      if (i >= 30) throw new Error("Calendar pagination did not finish");
      const before = await page.locator("table tbody tr[id]").count();
      await more.click();
      await page.waitForFunction(count => document.querySelectorAll("table tbody tr[id]").length > count, before, { timeout: 20000 });
    }
    const rows = parseVisibleForecasts(await page.content(), date);
    return { rows };
  } finally { await context.close(); }
}
