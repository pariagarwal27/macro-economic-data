/**
 * Fetch Investing.com calendar for a date range via getCalendarFilteredData.
 * Opens a real browser session first (Cloudflare), then paginates the API.
 *
 * Usage:
 *   npx tsx scripts/fetch-investing-api.ts 2026-08-09 2026-09-03 [out-stem]
 */
import fs from "fs";
import path from "path";
import { load } from "cheerio";
import { chromium, type Page } from "playwright";
import { isoToPickerDate } from "./investing-date-format";

const API_URL =
  "https://www.investing.com/economic-calendar/Service/getCalendarFilteredData";
const COUNTRY_IDS = ["5", "4", "72", "17", "22", "10", "26", "25"];
const KEEP = new Set(["US", "UK", "EA", "DE", "FR", "IT", "ES", "AU"]);

const CODE_MAP: Record<string, [string, string | null]> = {
  US: ["US", "USD"],
  UK: ["UK", "GBP"],
  GB: ["UK", "GBP"],
  EU: ["EA", "EUR"],
  EZ: ["EA", "EUR"],
  EA: ["EA", "EUR"],
  DE: ["DE", "EUR"],
  FR: ["FR", "EUR"],
  IT: ["IT", "EUR"],
  ES: ["ES", "EUR"],
  AU: ["AU", "AUD"],
};

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

export interface InvestingApiRow {
  date: string;
  time: string;
  currency: string | null;
  country: string;
  event: string;
  importance: number | null;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
}

function clean(t: string | undefined | null): string {
  return (t || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseHeaderDate(h: string): string | null {
  const m = h.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
}

function parseImportance(volTitle: string | undefined): number | null {
  if (!volTitle) return null;
  if (/High/i.test(volTitle)) return 3;
  if (/Moderate/i.test(volTitle)) return 2;
  if (/Low/i.test(volTitle)) return 1;
  return null;
}

export function parseCalendarHtml(html: string): InvestingApiRow[] {
  const $ = load(html);
  const rows: InvestingApiRow[] = [];
  let currentDate: string | null = null;

  $("tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (!tds.length) return;

    const dayText = clean($(tds[0]).text());
    if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i.test(dayText) && tds.length <= 2) {
      currentDate = parseHeaderDate(dayText);
      return;
    }
    if (tds.length < 6) return;

    const time = clean($(tds[1]).text());
    if (!/^\d{1,2}:\d{2}$/.test(time) && time !== "All Day") return;

    const code = clean($(tds[2]).text()).toUpperCase();
    const mapped = CODE_MAP[code] || [code, null];
    if (!KEEP.has(mapped[0])) return;

    const eventCell = $(tds[3]);
    const event = clean(eventCell.find("a").first().text());
    if (!event) return;

    const blob = clean(eventCell.text());
    const actM = blob.match(/Act:([^C]*?)(?:Cons:|$)/);
    const consM = blob.match(/Cons:([^P]*?)(?:Prev\.:|$)/);
    const prevM = blob.match(/Prev\.:?(.*)$/);

    let actual = clean($(tds[5]).text()) || null;
    let forecast = clean($(tds[6]).text()) || null;
    let previous = clean($(tds[7]).text()) || null;
    if (!actual && actM) actual = clean(actM[1]);
    if (!forecast && consM) forecast = clean(consM[1]);
    if (!previous && prevM) previous = clean(prevM[1]);
    if (actual === "-" || actual === "") actual = null;
    if (forecast === "-" || forecast === "") forecast = null;
    if (previous === "-" || previous === "") previous = null;

    rows.push({
      date: currentDate || "",
      time: time === "All Day" ? "00:00" : time,
      currency: mapped[1],
      country: mapped[0],
      event,
      importance: parseImportance($(tr).find('[title*="Volatility"]').attr("title")),
      actual,
      forecast,
      previous,
    });
  });

  return rows.filter((r) => r.date && r.event);
}

async function dismissOverlays(page: Page) {
  await page.keyboard.press("Escape").catch(() => {});
  for (const label of ["Accept All", "I Agree", "Accept", "Not now", "Maybe later", "Close"]) {
    const btn = page.getByRole("button", { name: new RegExp(label, "i") });
    if (await btn.count()) await btn.first().click({ timeout: 2000 }).catch(() => {});
  }
}

async function primeCalendarSession(page: Page) {
  await page.goto("https://www.investing.com/economic-calendar/", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForTimeout(2500);
  await dismissOverlays(page);
  await page.waitForSelector("table[class*=datatable]", { timeout: 30000 }).catch(() => {});
}

async function fetchApiHtmlInBrowser(
  page: Page,
  dateFrom: string,
  dateTo: string,
  limitFrom: number
): Promise<{ html: string; status: number; events: number }> {
  return page.evaluate(
    async ({ apiUrl, dateFrom, dateTo, limitFrom, countryIds }) => {
      const body = new URLSearchParams();
      for (const id of countryIds) body.append("country[]", id);
      body.append("importance[]", "1");
      body.append("importance[]", "2");
      body.append("importance[]", "3");
      body.set("dateFrom", dateFrom);
      body.set("dateTo", dateTo);
      body.set("timeZone", "55");
      body.set("timeFilter", "timeRemain");
      body.set("currentTab", "custom");
      body.set("limit_from", String(limitFrom));

      const resp = await fetch(apiUrl, {
        method: "POST",
        credentials: "include",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: body.toString(),
      });
      const text = await resp.text();
      if (!resp.ok) return { html: "", status: resp.status, events: 0, err: text.slice(0, 120) };
      let data = "";
      try {
        data = JSON.parse(text).data ?? "";
      } catch {
        data = text;
      }
      return {
        html: data,
        status: resp.status,
        events: (data.match(/js-event-item/g) || []).length,
      };
    },
    { apiUrl: API_URL, dateFrom, dateTo, limitFrom, countryIds: COUNTRY_IDS }
  );
}

async function fetchViaApplyIntercept(
  page: Page,
  dateFrom: string,
  dateTo: string
): Promise<string | null> {
  const customBtn = page.getByRole("button", { name: /Custom dates/i });
  if (await customBtn.count()) await customBtn.first().click();

  const start = page.locator("#date-picker-start-day");
  const end = page.locator("#date-picker-end-day");
  await start.waitFor({ state: "visible", timeout: 15000 });
  await end.waitFor({ state: "visible", timeout: 15000 });
  await start.fill(isoToPickerDate(dateFrom));
  await end.fill(isoToPickerDate(dateTo));

  const responseP = page.waitForResponse(
    (r) => r.url().includes("getCalendarFilteredData") && r.status() === 200,
    { timeout: 30000 }
  );
  await page.locator('[data-test="date-picker-apply"]').click({ force: true });
  const resp = await responseP.catch(() => null);
  if (!resp) return null;
  const json = (await resp.json()) as { data?: string };
  return json.data ?? null;
}

export async function fetchInvestingRange(dateFrom: string, dateTo: string) {
  const browser = await chromium.launch({
    headless: process.env.INVESTING_HEADLESS === "1",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-GB",
    viewport: { width: 1400, height: 900 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();

  try {
    await primeCalendarSession(page);

    const all: InvestingApiRow[] = [];
    const seen = new Set<string>();
    let apiStatus = 0;

    for (let pageNum = 0; pageNum < 50; pageNum++) {
      const batch = await fetchApiHtmlInBrowser(page, dateFrom, dateTo, pageNum);
      apiStatus = batch.status;
      if (batch.status !== 200 || !batch.html) break;

      let added = 0;
      for (const row of parseCalendarHtml(batch.html)) {
        const key = `${row.date}|${row.time}|${row.country}|${row.event}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(row);
        added++;
      }
      if (!added || batch.events < 180) break;
    }

    if (all.length === 0) {
      const html = await fetchViaApplyIntercept(page, dateFrom, dateTo);
      if (html) {
        for (const row of parseCalendarHtml(html)) {
          const key = `${row.date}|${row.time}|${row.country}|${row.event}`;
          if (seen.has(key)) continue;
          seen.add(key);
          all.push(row);
        }
      }
    }

    if (all.length === 0) {
      throw new Error(`No rows fetched (last API status ${apiStatus})`);
    }

    all.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    const dates = all.map((r) => r.date);
    return {
      rows: all,
      meta: {
        apiStatus,
        minDate: dates.reduce((a, b) => (a < b ? a : b)),
        maxDate: dates.reduce((a, b) => (a > b ? a : b)),
      },
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const dateFrom = process.argv[2] ?? "2026-08-09";
  const dateTo = process.argv[3] ?? "2026-09-03";
  const outStem = process.argv[4] ?? `${dateFrom}_to_${dateTo}`;
  const outDir = path.join(process.cwd(), "data", "investing");
  const outFile = path.join(outDir, `${outStem}.json`);

  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Fetching ${dateFrom} → ${dateTo} via calendar API…`);

  const { rows, meta } = await fetchInvestingRange(dateFrom, dateTo);
  const dump = {
    source: "investing",
    timezone: "BST",
    range: { from: dateFrom, to: dateTo },
    note: "getCalendarFilteredData after browser session; BST wall times",
    rows,
  };
  fs.writeFileSync(outFile, JSON.stringify(dump, null, 2));

  console.log(
    JSON.stringify(
      {
        outFile,
        rows: rows.length,
        ...meta,
        us: rows.filter((r) => r.country === "US").length,
        uk: rows.filter((r) => r.country === "UK").length,
        ea: rows.filter((r) => r.country === "EA").length,
      },
      null,
      2
    )
  );
}

if (process.argv[1]?.includes("fetch-investing-api")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
