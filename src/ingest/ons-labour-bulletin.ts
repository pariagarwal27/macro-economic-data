import type { RawPoint } from "./transforms";

/**
 * Latest ILO unemployment rate headline from the UK Labour Market bulletin.
 * ONS MGSX timeseries often lags the bulletin by ~1 month.
 */
export async function fetchUkLabourMarketBulletinUe(): Promise<RawPoint | null> {
  const res = await fetch(
    "https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/bulletins/uklabourmarket/latest",
    {
      headers: {
        Accept: "text/html",
        "User-Agent": "macro-economy-tracker/1.0",
      },
    }
  );
  if (!res.ok) throw new Error(`ONS labour bulletin ${res.status}`);
  const text = (await res.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  const m =
    text.match(
      /unemployment rate for people aged 16 years and over was estimated at\s+(\d+\.\d+)%\s+in\s+([A-Za-z]+)\s+to\s+([A-Za-z]+)\s+(20\d{2})/i
    ) ??
    text.match(
      /unemployment rate[^.]{0,80}?estimated at\s+(\d+\.\d+)%\s+in\s+([A-Za-z]+)\s+to\s+([A-Za-z]+)\s+(20\d{2})/i
    );
  if (!m) return null;

  const value = Number(m[1]);
  const endMonth = m[3]!;
  const year = m[4]!;
  const date = monthYearToDate(endMonth, year);
  if (!date || !Number.isFinite(value)) return null;
  return { date, value };
}

function monthYearToDate(month: string, year: string): string | null {
  const map: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };
  const mm = map[month.toLowerCase()];
  return mm ? `${year}-${mm}-01` : null;
}
