export type CalendarEventKind = "data" | "speaker" | "policy" | "auction" | "other";

export type TapeRegion = "US" | "UK" | "EA" | "OTHER";

export function classifyCalendarEvent(eventName: string): CalendarEventKind {
  const n = eventName.toLowerCase();
  if (/\b(speaks|speech|testimony|remarks|participates in|holds a speech)\b/.test(n)) {
    return "speaker";
  }
  if (
    /\b(fomc|fed interest rate|interest rate decision|monetary policy statement|ecb.*rate|boe.*rate|rate statement|policy rate)\b/.test(
      n
    )
  ) {
    return "policy";
  }
  if (/\b(auction|bill auction|bond auction|obligation auction|oat auction|bonos auction)\b/.test(n)) {
    return "auction";
  }
  return "data";
}

export function calendarCountryToRegion(country: string): TapeRegion {
  const c = country.toUpperCase().trim();
  if (c === "US" || c === "USA") return "US";
  if (c === "UK" || c === "GB") return "UK";
  if (["EA", "DE", "FR", "IT", "ES", "EU", "EMU", "EZ"].includes(c)) return "EA";
  return "OTHER";
}

export function speakerInstitution(eventName: string): string | null {
  const n = eventName.toLowerCase();
  if (
    /\b(fed|fomc|powell|waller|goolsbee|bostic|barkin|bowman|jefferson|kugler|mester|daly|harker|kashkari|logan|cook|williams|barr|warsh)\b/.test(
      n
    )
  ) {
    return "Fed";
  }
  if (
    /\b(ecb|lagarde|de guindos|schnabel|villeroy|patsalides|centeno|reis|holzmann|lane|nagel)\b/.test(
      n
    )
  ) {
    return "ECB";
  }
  if (/\b(boe|bailey|pill|ramsden|breeden|dhingra|greene|mann|broadbent)\b/.test(n)) {
    return "BoE";
  }
  if (/\b(boj|ueda|tamura)\b/.test(n)) return "BoJ";
  if (/\b(rba|bullock)\b/.test(n)) return "RBA";
  return null;
}


export function importanceStars(importance: number | null | undefined): number {
  if (importance == null || !Number.isFinite(importance)) return 0;
  return Math.max(0, Math.min(3, Math.round(importance)));
}

export function formatUtcTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function addUtcDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}

export function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Preserve the release tape's existing forward/today windows, and add an
 * explicit past-only window for the overview's historical calendar. */
export function releaseTapeWindow(now: Date, days: number, options: { forwardOnly?: boolean; pastOnly?: boolean } = {}) {
  const start = options.pastOnly ? addUtcDays(now, -days) : options.forwardOnly === false ? utcDayStart(now) : now;
  const end = options.pastOnly ? now : addUtcDays(start, days);
  return { start, end };
}

export function formatDayHeader(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function formatRawCalendarValue(
  value: number | null | undefined,
  raw: string | null | undefined
): string {
  if (raw && raw.trim() && raw !== "-") return raw.trim();
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

type DedupeRow = {
  releasedAt: string;
  eventName: string;
  country: string;
  periodLabel: string | null;
  forecast: number | null;
  importance: number | null;
};

export function dedupeCalendarRows<T extends DedupeRow>(rows: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.country}|${row.eventName}|${row.periodLabel ?? ""}|${dayKey(row.releasedAt)}`;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, row);
      continue;
    }
    const score = (r: DedupeRow) =>
      (r.forecast != null ? 4 : 0) +
      importanceStars(r.importance) +
      (r.releasedAt < cur.releasedAt ? 0.1 : 0);
    if (score(row) > score(cur)) byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => a.releasedAt.localeCompare(b.releasedAt));
}
