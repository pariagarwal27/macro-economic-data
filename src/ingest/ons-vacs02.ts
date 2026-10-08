import * as XLSX from "xlsx";
import * as cheerio from "cheerio";
import type { RawPoint } from "./transforms";

const DATASET_PAGE = "https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/datasets/vacanciesbyindustryvacs02";
let cached: { points: RawPoint[]; at: number } | null = null;
const CACHE_MS = 15 * 60 * 1000;

export async function fetchOnsJobOpeningsRate(): Promise<RawPoint[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.points;

  const page = await fetch(DATASET_PAGE, {
    headers: { Accept: "text/html", "User-Agent": "macro-economy-tracker/1.0" },
    cache: "no-store",
  });
  if (!page.ok) throw new Error(`ONS VACS02 dataset page ${page.status}`);

  const $ = cheerio.load(await page.text());
  let workbookUrl: string | undefined;
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    if (/vacs02[^/]*\.xlsx(?:[?#]|$)/i.test(href)) {
      workbookUrl = href.startsWith("http") ? href : `https://www.ons.gov.uk${href}`;
    }
  });
  if (!workbookUrl) throw new Error("ONS VACS02 current workbook link not found");

  const workbookResponse = await fetch(workbookUrl, {
    headers: {
      Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "User-Agent": "macro-economy-tracker/1.0",
    },
    cache: "no-store",
  });
  if (!workbookResponse.ok) throw new Error(`ONS VACS02 workbook ${workbookResponse.status}`);
  const bytes = Buffer.from(await workbookResponse.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("ONS VACS02 response was not an XLSX workbook");
  }

  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets["job openings rate"];
  if (!sheet) throw new Error('ONS VACS02 workbook is missing the "job openings rate" sheet');

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const seriesColumn = (rows[5] ?? []).findIndex((value) => String(value ?? "").trim() === "N4JE");
  if (seriesColumn < 0) throw new Error("ONS VACS02 workbook is missing national series N4JE");

  const points = rows.slice(8).flatMap((row) => {
    const date = rollingPeriodEnd(row?.[0]);
    const value = row?.[seriesColumn];
    return date && typeof value === "number" && Number.isFinite(value)
      ? [{ date, value }]
      : [];
  });
  if (!points.length) throw new Error("ONS VACS02 N4JE series contains no observations");

  points.sort((a, b) => a.date.localeCompare(b.date));
  cached = { points, at: Date.now() };
  return points;
}

function rollingPeriodEnd(value: unknown): string | null {
  const match = String(value ?? "").trim().match(/^[A-Za-z]{3}-[A-Za-z]{3}\s+(\d{4})$/);
  if (!match) return null;
  const endMonth = String(value).trim().slice(4, 7).toLowerCase();
  const month = MONTHS[endMonth];
  return month ? `${match[1]}-${month}-01` : null;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
