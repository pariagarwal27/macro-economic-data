import type { ReleaseStage } from "./release-stages";

const GDP_Q3_2026_FLASH_URL = "https://ec.europa.eu/eurostat/web/products-euro-indicators/w/2-30102026-ap";

export type EurostatGdpFlashResult = {
  periodDate: string;
  value: number;
  rawValue: number;
  releaseStage: ReleaseStage;
  releasedAt: string;
  note: string;
};

/** Fetch the directly published Eurostat flash article when the dataset API lags its release. */
export async function fetchEurostatGdpFlashRelease(
  metricId: string,
  expectedPeriodDate?: string,
): Promise<EurostatGdpFlashResult | null> {
  if (!expectedPeriodDate || (metricId !== "ea-gdp-qoq" && metricId !== "ea-gdp-yoy")) return null;
  // The Eurostat Q3 2026 release page has the verified EA flash table. Later
  // quarters continue through the API until their own article is registered.
  if (expectedPeriodDate !== "2026-07-01") return null;

  let response: Response;
  try {
    response = await fetch(GDP_Q3_2026_FLASH_URL, {
      cache: "no-store",
      headers: { Accept: "text/html,*/*", "User-Agent": "macro-economy-tracker/1.0" },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const html = await response.text();
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ");

  const quarter = "third quarter of 2026";
  const qoq = text.match(new RegExp(`In the ${quarter},\\s*seasonally adjusted GDP\\s+(increased|decreased) by\\s+([0-9]+(?:\\.[0-9]+)?)% in the euro area`, "i"));
  const yoy = text.match(/Compared with the same quarter of the previous year,\s*seasonally adjusted GDP\s+(increased|decreased) by\s+([0-9]+(?:\.[0-9]+)?)% in the euro area/i);
  const match = metricId === "ea-gdp-qoq" ? qoq : yoy;
  if (!match) return null;

  const magnitude = Number(match[2]);
  if (!Number.isFinite(magnitude)) return null;
  const value = match[1]!.toLowerCase() === "decreased" ? -magnitude : magnitude;
  return {
    periodDate: expectedPeriodDate,
    value,
    rawValue: value,
    releaseStage: "flash",
    releasedAt: new Date().toISOString(),
    note: `Official Eurostat Q3 2026 preliminary GDP flash release: ${GDP_Q3_2026_FLASH_URL}`,
  };
}
