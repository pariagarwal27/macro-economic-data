import type { RawPoint } from "./transforms";

/**
 * BLS HTML news-release scrapers — used when the Public Data API is down/lagging.
 * These pages update at the official release timestamp.
 */

export async function fetchBlsEmpsitRelease(): Promise<{
  nfpChange: RawPoint | null;
  unemployment: RawPoint | null;
  period: string | null;
}> {
  const res = await fetch("https://www.bls.gov/news.release/empsit.nr0.htm", {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; macro-economy-tracker/1.0)",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`BLS empsit HTML ${res.status}`);
  const html = await res.text();
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  const period =
    text.match(/Results\s*-\s*(\d{4})\s*M(\d{2})/i) ??
    text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);

  let date: string | null = null;
  if (period && period[0].includes("M")) {
    date = `${period[1]}-${period[2]}-01`;
  } else if (period) {
    date = monthYearToDate(period[1], period[2]);
  }

  const nfpMatch =
    text.match(
      /nonfarm payroll employment[^.]*?\(([+-]?[\d,]+)\)/i
    ) ??
    text.match(
      /payroll employment changed[^.]*?\(([+-]?[\d,]+)\)/i
    );

  const uMatch =
    text.match(/unemployment rate[^.]*?\b(\d+\.\d+)\s*percent/i) ??
    text.match(/unemployment rate\s*\((\d+\.\d+)\)/i);

  return {
    period: date,
    nfpChange:
      nfpMatch && date
        ? {
            date,
            // BLS text uses "(-23,000)" meaning -23 thousand jobs
            value: Number(nfpMatch[1].replace(/,/g, "")) / 1000,
          }
        : null,
    unemployment:
      uMatch && date ? { date, value: Number(uMatch[1]) } : null,
  };
}

export async function fetchBlsCpiRelease(): Promise<{
  cpiMom: RawPoint | null;
  cpiYoy: RawPoint | null;
  coreMom: RawPoint | null;
  coreYoy: RawPoint | null;
  period: string | null;
}> {
  const res = await fetch("https://www.bls.gov/news.release/cpi.nr0.htm", {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; macro-economy-tracker/1.0)",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`BLS CPI HTML ${res.status}`);
  const text = (await res.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  const period = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i
  );
  const date = period ? monthYearToDate(period[1], period[2]) : null;

  // MoM: catch rose/fell/increased/decreased/unchanged and apply sign.
  const mom =
    text.match(
      /\(CPI-U\)\s+(increased|decreased|rose|fell|was unchanged)(?:\s+by)?\s*(\d+\.\d+)?\s*percent(?:age points)?\s+on a seasonally adjusted basis/i
    ) ??
    text.match(
      /All Urban Consumers \(CPI-U\)\s+(increased|decreased|rose|fell|was unchanged)(?:\s+by)?\s*(\d+\.\d+)?\s*percent/i
    );

  const yoy = text.match(
    /Over the last 12 months,\s+the all items index (increased|decreased|rose|fell)\s+(\d+\.\d+)\s*percent/i
  );

  const coreMomUnchanged = text.match(
    /(?:The )?index for all items less food and energy was unchanged in [A-Za-z]+/i
  );
  const coreMom = coreMomUnchanged
    ? (["unchanged", undefined] as const)
    : text.match(
        /(?:The )?index for all items less food and energy (increased|decreased|rose|fell)(?:\s+by)?\s*(\d+\.\d+)\s*percent(?:age points)?\s+in [A-Za-z]+/i
      );

  const coreYoy = text.match(
    /The all items less food and energy index (increased|decreased|rose|fell)\s+(\d+\.\d+)\s*percent for the 12 months/i
  ) ??
    text.match(
      /all items less food and energy index (increased|decreased|rose|fell)\s+(\d+\.\d+)\s*percent over the year/i
    );

  return {
    period: date,
    cpiMom: mom && date ? { date, value: signedPct(mom[1], mom[2]) } : null,
    cpiYoy: yoy && date ? { date, value: signedPct(yoy[1], yoy[2]) } : null,
    coreMom:
      coreMom && date
        ? {
            date,
            value:
              typeof coreMom[0] === "string" && /unchanged/i.test(String(coreMom[0]))
                ? 0
                : signedPct(String(coreMom[1] ?? "unchanged"), coreMom[2] as string | undefined),
          }
        : null,
    coreYoy:
      coreYoy && date ? { date, value: signedPct(coreYoy[1], coreYoy[2]) } : null,
  };
}

function signedPct(verb: string, num: string | undefined): number {
  if (/unchanged/i.test(verb) || num === undefined || num === "") return 0;
  const v = Number(num);
  if (!Number.isFinite(v)) return NaN;
  if (/decreased|fell|down/i.test(verb)) return -Math.abs(v);
  return Math.abs(v);
}

/** Map scraped headline prints onto metric ids when API series are unavailable. */
export function blsReleaseFallbackPoints(
  metricId: string,
  empsit: Awaited<ReturnType<typeof fetchBlsEmpsitRelease>>,
  cpi: Awaited<ReturnType<typeof fetchBlsCpiRelease>> | null
): RawPoint[] | null {
  if (metricId === "us-nfp" && empsit.nfpChange) {
    return [empsit.nfpChange]; // already monthly change in thousands
  }
  if (metricId === "us-unemployment" && empsit.unemployment) {
    return [empsit.unemployment];
  }
  if (!cpi) return null;
  if (metricId === "us-cpi-mom" && cpi.cpiMom) return [cpi.cpiMom];
  if (metricId === "us-cpi-yoy" && cpi.cpiYoy) return [cpi.cpiYoy];
  if (metricId === "us-core-cpi-mom" && cpi.coreMom) return [cpi.coreMom];
  if (metricId === "us-core-cpi-yoy" && cpi.coreYoy) return [cpi.coreYoy];
  return null;
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
  if (!mm) return null;
  return `${year}-${mm}-01`;
}
