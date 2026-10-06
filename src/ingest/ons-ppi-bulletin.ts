import type { RawPoint } from "./transforms";

/**
 * Scrape latest UK Producer Price Inflation bulletin headlines.
 * Useful when timeseries lag or CDIDs change after ONS PPI methodology restarts.
 */
export async function fetchOnsPpiBulletin(): Promise<{
  inputYoy: RawPoint | null;
  outputYoy: RawPoint | null;
  period: string | null;
}> {
  const res = await fetch(
    "https://www.ons.gov.uk/economy/inflationandpriceindices/bulletins/producerpriceinflation/latest",
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; macro-economy-tracker/1.0)",
        Accept: "text/html",
      },
    }
  );
  if (!res.ok) throw new Error(`ONS PPI bulletin ${res.status}`);
  const text = (await res.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  const period =
    text.match(
      /Producer price inflation,\s*UK:\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})/i
    ) ??
    text.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/
    );

  const date = period ? monthYearToDate(period[1], period[2]) : null;

  const input = text.match(
    /Producer input prices rose by\s+(\d+\.\d+)%\s+in the year to\s+[A-Za-z]+\s+20\d{2}/i
  );
  const output = text.match(
    /Producer output \(factory gate\) prices rose by\s+(\d+\.\d+)%\s+in the year to\s+[A-Za-z]+\s+20\d{2}/i
  );

  return {
    period: date,
    inputYoy:
      input && date ? { date, value: Number(input[1]) } : null,
    outputYoy:
      output && date ? { date, value: Number(output[1]) } : null,
  };
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
