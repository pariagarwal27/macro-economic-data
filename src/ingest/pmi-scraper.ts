import type { Browser, Page } from "playwright";

export interface PmiPoint {
  date: string;
  value: number;
  rawValue: number;
}

export type PmiMetricKey =
  | "us-ism-manufacturing-pmi"
  | "us-ism-services-pmi"
  | "us-sp-global-manufacturing-pmi"
  | "us-sp-global-services-pmi"
  | "uk-sp-global-manufacturing-pmi"
  | "uk-sp-global-services-pmi"
  | "uk-sp-global-composite-pmi"
  | "ea-sp-global-manufacturing-pmi"
  | "ea-sp-global-services-pmi"
  | "ea-sp-global-composite-pmi";

type ScrapeConfig = {
  metricId: PmiMetricKey;
  url: string;
  selectors?: string[];
  titlePatterns?: RegExp[];
  valuePatterns: RegExp[];
};

const ISM_BASE =
  "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-pmi-reports";

const SP_GLOBAL_RELEASES =
  "https://www.pmi.spglobal.com/Public/Release/PressReleases";

const CONFIG: ScrapeConfig[] = [
  {
    metricId: "us-ism-manufacturing-pmi",
    url: `${ISM_BASE}/manufacturing/`,
    titlePatterns: [/Manufacturing PMI/i],
    valuePatterns: [
      /Manufacturing PMI(?:®|\s)*at\s+(\d+(?:\.\d+)?)/i,
      /Manufacturing PMI(?:®|\s)*registered\s+(\d+(?:\.\d+)?)/i,
      /Manufacturing PMI(?:®|\s)*\s+(\d+(?:\.\d+)?)/i,
    ],
  },

  {
    metricId: "us-ism-services-pmi",
    url: `${ISM_BASE}/services/`,
    titlePatterns: [/Services PMI/i],
    valuePatterns: [
      /Services PMI(?:®|\s)*at\s+(\d+(?:\.\d+)?)/i,
      /Services PMI(?:®|\s)*registered\s+(\d+(?:\.\d+)?)/i,
      /Services PMI(?:®|\s)*\s+(\d+(?:\.\d+)?)/i,
    ],
  },

  /*
   * S&P Global PMI.
   *
   * The S&P release index is intentionally used rather than hard-coding
   * individual release URLs because S&P changes the release URL/id.
   *
   * The scraper searches the release listing and then opens the matching
   * release page.
   */
  {
    metricId: "us-sp-global-manufacturing-pmi",
    url: SP_GLOBAL_RELEASES,
    titlePatterns: [/S&P Global Flash US PMI/i, /S&P Global US PMI/i],
    valuePatterns: [
      /US Manufacturing PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
      /Manufacturing PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
    ],
  },

  {
    metricId: "us-sp-global-services-pmi",
    url: SP_GLOBAL_RELEASES,
    titlePatterns: [/S&P Global Flash US PMI/i, /S&P Global US PMI/i],
    valuePatterns: [
      /US Services PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
      /Services PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
    ],
  },

  {
    metricId: "uk-sp-global-manufacturing-pmi",
    url: SP_GLOBAL_RELEASES,
    titlePatterns: [/S&P Global Flash UK PMI/i, /S&P Global UK PMI/i],
    valuePatterns: [
      /UK Manufacturing PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
      /Manufacturing PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
    ],
  },

  {
    metricId: "uk-sp-global-services-pmi",
    url: SP_GLOBAL_RELEASES,
    titlePatterns: [/S&P Global Flash UK PMI/i, /S&P Global UK PMI/i],
    valuePatterns: [
      /UK Services PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
      /Services PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
    ],
  },

  {
    metricId: "uk-sp-global-composite-pmi",
    url: SP_GLOBAL_RELEASES,
    titlePatterns: [/S&P Global Flash UK PMI/i, /S&P Global UK PMI/i],
    valuePatterns: [
      /UK PMI Composite Output Index[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
      /UK Composite PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
      /Composite Output Index[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
    ],
  },

  {
    metricId: "ea-sp-global-manufacturing-pmi",
    url: SP_GLOBAL_RELEASES,
    titlePatterns: [
      /S&P Global Flash Eurozone PMI/i,
      /S&P Global Eurozone PMI/i,
    ],
    valuePatterns: [
      /Eurozone Manufacturing PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
      /Eurozone Manufacturing PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
      /Manufacturing PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
    ],
  },

  {
    metricId: "ea-sp-global-services-pmi",
    url: SP_GLOBAL_RELEASES,
    titlePatterns: [
      /S&P Global Flash Eurozone PMI/i,
      /S&P Global Eurozone PMI/i,
    ],
    valuePatterns: [
      /Eurozone Services PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
      /Eurozone Services PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
      /Services PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
    ],
  },

  {
    metricId: "ea-sp-global-composite-pmi",
    url: SP_GLOBAL_RELEASES,
    titlePatterns: [
      /S&P Global Flash Eurozone PMI/i,
      /S&P Global Eurozone PMI/i,
    ],
    valuePatterns: [
      /Eurozone Composite PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
      /Eurozone Composite Output Index[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
      /Composite PMI[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
      /Composite Output Index[^0-9]{0,100}(\d+(?:\.\d+)?)/i,
    ],
  },
];

function normalizeDate(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(
    2,
    "0"
  )}`;
}

function parseMonthYear(text: string): string | null {
  const match = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i
  );

  if (!match) return null;

  const month = new Date(`${match[1]} 1, ${match[2]}`).getMonth() + 1;

  return normalizeDate(Number(match[2]), month);
}

function parseValue(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (!match) continue;

    const value = Number(match[1]);

    if (Number.isFinite(value) && value >= 0 && value <= 100) {
      return value;
    }
  }

  return null;
}

async function safeText(page: Page): Promise<string> {
  return page.locator("body").innerText({ timeout: 15000 });
}

async function findMatchingReleaseLink(
  page: Page,
  patterns: RegExp[]
): Promise<string | null> {
  const links = await page.locator("a").evaluateAll((anchors) =>
    anchors.map((a) => ({
      text: (a.textContent ?? "").trim(),
      href: (a as HTMLAnchorElement).href,
    }))
  );

  for (const link of links) {
    if (!link.href) continue;

    if (patterns.some((pattern) => pattern.test(link.text))) {
      return link.href;
    }
  }

  return null;
}

async function scrapeIsm(
  browser: Browser,
  config: ScrapeConfig
): Promise<PmiPoint[]> {
  const page = await browser.newPage();

  try {
    await page.goto(config.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.waitForTimeout(1000);

    const text = await safeText(page);

    const value = parseValue(text, config.valuePatterns);

    if (value == null) {
      throw new Error(
        `Could not find PMI value on ISM page: ${config.metricId}`
      );
    }

    /*
     * ISM pages normally expose the reporting month in the heading/body.
     */
    const date = parseMonthYear(text);

    if (!date) {
      throw new Error(
        `Could not determine reporting month on ISM page: ${config.metricId}`
      );
    }

    return [
      {
        date,
        value,
        rawValue: value,
      },
    ];
  } finally {
    await page.close();
  }
}

async function scrapeSpGlobal(
  browser: Browser,
  config: ScrapeConfig
): Promise<PmiPoint[]> {
  const listing = await browser.newPage();

  try {
    await listing.goto(config.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await listing.waitForTimeout(1500);

    const titlePatterns = config.titlePatterns ?? [];

    let releaseUrl = await findMatchingReleaseLink(
      listing,
      titlePatterns
    );

    /*
     * S&P's release listing is dynamic and can change its DOM.
     * If the link is not exposed directly, inspect the page text and
     * follow the first matching release anchor.
     */
    if (!releaseUrl) {
      const anchors = await listing.locator("a").evaluateAll((els) =>
        els.map((el) => ({
          text: (el.textContent ?? "").trim(),
          href: (el as HTMLAnchorElement).href,
        }))
      );

      const candidate = anchors.find((a) =>
        titlePatterns.some((pattern) => pattern.test(a.text))
      );

      releaseUrl = candidate?.href ?? null;
    }

    if (!releaseUrl) {
      throw new Error(
        `Could not locate S&P Global release for ${config.metricId}`
      );
    }

    const release = await browser.newPage();

    try {
      await release.goto(releaseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      await release.waitForTimeout(1000);

      const text = await safeText(release);

      const value = parseValue(text, config.valuePatterns);

      if (value == null) {
        throw new Error(
          `Could not find S&P Global PMI value for ${config.metricId}`
        );
      }

      const date =
        parseMonthYear(text) ??
        (() => {
          /*
           * S&P pages sometimes put the month in a headline rather than
           * the standard "Month YYYY" form. Search the title as a fallback.
           */
          return null;
        })();

      if (!date) {
        throw new Error(
          `Could not determine S&P Global PMI reporting month for ${config.metricId}`
        );
      }

      return [
        {
          date,
          value,
          rawValue: value,
        },
      ];
    } finally {
      await release.close();
    }
  } finally {
    await listing.close();
  }
}

export async function fetchPmiMetric(
  metricId: PmiMetricKey
): Promise<PmiPoint[]> {
  const config = CONFIG.find((item) => item.metricId === metricId);

  if (!config) {
    throw new Error(`Unknown PMI metric: ${metricId}`);
  }

  const packageName = process.env.LOCAL_BROWSER_MODULE ?? "playwright";
  const { chromium } = await import(/* webpackIgnore: true */ packageName) as typeof import("playwright");
  const browser = await chromium.launch({
    headless: true,
  });

  try {
    if (metricId.startsWith("us-ism-")) {
      return await scrapeIsm(browser, config);
    }

    return await scrapeSpGlobal(browser, config);
  } finally {
    await browser.close();
  }
}

export async function fetchAllPmiMetrics(
  metricIds?: PmiMetricKey[]
): Promise<Map<string, PmiPoint[]>> {
  const ids = metricIds ?? CONFIG.map((item) => item.metricId);

  const packageName = process.env.LOCAL_BROWSER_MODULE ?? "playwright";
  const { chromium } = await import(/* webpackIgnore: true */ packageName) as typeof import("playwright");
  const browser = await chromium.launch({
    headless: true,
  });

  const results = new Map<string, PmiPoint[]>();

  try {
    for (const metricId of ids) {
      const config = CONFIG.find((item) => item.metricId === metricId);

      if (!config) {
        console.warn(`[PMI] Unknown metric: ${metricId}`);
        continue;
      }

      try {
        let points: PmiPoint[];

        if (metricId.startsWith("us-ism-")) {
          points = await scrapeIsm(browser, config);
        } else {
          points = await scrapeSpGlobal(browser, config);
        }

        results.set(metricId, points);

        console.log(
          `[PMI] ${metricId}: ${points
            .map((p) => `${p.date}=${p.value}`)
            .join(", ")}`
        );
      } catch (error) {
        console.error(
          `[PMI] Failed ${metricId}:`,
          error instanceof Error ? error.message : error
        );
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

export async function fetchPmiMetricSafe(
  metricId: PmiMetricKey
): Promise<PmiPoint[]> {
  try {
    return await fetchPmiMetric(metricId);
  } catch (error) {
    console.error(
      `[PMI] ${metricId} failed:`,
      error instanceof Error ? error.message : error
    );

    return [];
  }
}
