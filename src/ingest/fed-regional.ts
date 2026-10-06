import type { RawPoint } from "./transforms";

/**
 * Atlanta Fed GDPNow — scraped from the official tool page / data feed.
 * Updates frequently between BEA GDP releases (well ahead of FRED).
 */
export async function fetchGdpNow(): Promise<RawPoint[]> {
  const candidates = [
    "https://www.atlantafed.org/-/media/documents/cqer/researchcq/gdpnow/GDPTrackingModelDataAndForecasts.xlsx",
    "https://www.atlantafed.org/cqer/research/gdpnow",
  ];

  // HTML page often embeds the latest nowcast prominently
  const page = await fetch(candidates[1], {
    headers: {
      "User-Agent": "macro-economy-tracker/1.0",
      Accept: "text/html",
    },
  });
  if (!page.ok) throw new Error(`GDPNow page ${page.status}`);
  const html = await page.text();

  // Patterns like "2.4 percent" near "GDPNow"
  const pct =
    html.match(/GDPNow[^%]{0,120}?([+-]?\d+\.\d+)\s*percent/i) ??
    html.match(/nowcast[^%]{0,80}?([+-]?\d+\.\d+)\s*%/i) ??
    html.match(/([+-]?\d+\.\d+)\s*percent[^.]{0,40}GDPNow/i);

  const dateMatch =
    html.match(/Updated:\s*([A-Za-z]+\s+\d{1,2},\s+20\d{2})/i) ??
    html.match(/as\s+of\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2})/i);

  if (!pct) throw new Error("Could not parse GDPNow value from Atlanta Fed page");

  const value = Number(pct[1]);
  const date = dateMatch
    ? new Date(dateMatch[1]).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return [{ date, value }];
}

/**
 * Cleveland Fed Inflation Expectations JSON/CSV when available.
 */
export async function fetchClevelandExpInflation(): Promise<RawPoint[]> {
  const url =
    "https://www.clevelandfed.org/indicators-and-data/inflation-expectations";
  const res = await fetch(url, {
    headers: { "User-Agent": "macro-economy-tracker/1.0", Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`Cleveland Fed ${res.status}`);
  const html = await res.text();
  // Prefer structured numbers near "1-year" expected inflation
  const m = html.match(/1-year[^%]{0,60}?(\d+\.\d+)\s*%/i);
  if (!m) throw new Error("Cleveland inflation expectations parse failed");
  return [
    {
      date: new Date().toISOString().slice(0, 10).replace(/-\d{2}$/, "-01"),
      value: Number(m[1]),
    },
  ];
}
