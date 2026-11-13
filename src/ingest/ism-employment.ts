import { load } from "cheerio";

const REPORT_URLS = {
  manufacturing: "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-pmi-reports/pmi/manufacturing/",
  services: "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-pmi-reports/services/",
} as const;

type IsmEmploymentSeries = keyof typeof REPORT_URLS;

function normalizeText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function periodEndFromReport(text: string) {
  const match = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  if (!match) return null;
  const month = new Date(`${match[1]} 1, ${match[2]}`).getMonth() + 1;
  const year = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

function employmentSectionText($: ReturnType<typeof load>, bodyText: string) {
  const heading = $("h1,h2,h3,h4,h5").toArray().find(element => normalizeText($(element).text()).toLowerCase() === "employment");
  if (!heading) return bodyText;

  let section = "";
  let node = $(heading).next();
  for (let index = 0; node.length && index < 24; index += 1, node = node.next()) {
    if (/^h[1-5]$/i.test(node.get(0)?.tagName ?? "")) break;
    section += ` ${node.text()}`;
  }
  return normalizeText(section) || bodyText;
}

function parseEmploymentIndex(series: IsmEmploymentSeries, text: string) {
  const direct = series === "manufacturing"
    ? [
        /Employment Index\s+(?:registered|reading of|was)\s+(\d{1,2}(?:\.\d+)?)\s*(?:percent|%)/i,
        /Employment Index\s+reading of\s+(\d{1,2}(?:\.\d+)?)\s*(?:percent|%)/i,
      ]
    : [
        /Employment activity in the services sector[\s\S]{0,300}?index registered\s+(\d{1,2}(?:\.\d+)?)\s*(?:percent|%)/i,
        /Services Employment Index[\s\S]{0,120}?(?:registered|at)\s+(\d{1,2}(?:\.\d+)?)\s*(?:percent|%)/i,
      ];
  const sectionPattern = /(?:index\s+(?:registered|was|is)|registered|reading of|at)\s+(\d{1,2}(?:\.\d+)?)\s*(?:percent|%)/i;
  const match = [...direct.map(pattern => text.match(pattern)).filter(Boolean), text.match(sectionPattern)].find(Boolean);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** Fetch and parse the employment sub-index from an official ISM report page. */
export async function fetchIsmEmploymentIndex(series: IsmEmploymentSeries, signal?: AbortSignal) {
  const response = await fetch(REPORT_URLS[series], {
    headers: { Accept: "text/html", "User-Agent": "MacroEconomicDashboard/1.0" },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`ISM ${series} report returned HTTP ${response.status}`);
  const $ = load(await response.text());
  const bodyText = normalizeText($("body").text());
  const section = employmentSectionText($, bodyText);
  const periodDate = periodEndFromReport(bodyText);
  const value = parseEmploymentIndex(series, section);
  if (!periodDate || value == null) throw new Error(`ISM ${series} employment index is not available on the official report page`);
  return {
    periodDate,
    value,
    rawValue: value,
    note: `Official ISM ${series} employment index`,
  };
}
