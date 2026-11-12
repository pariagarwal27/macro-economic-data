import { mapInvestingEvent, investingToCatalogScale } from "@/catalog/investing-map";
import { getClient } from "@/db";

export function parseInvestingNumber(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  const value = input.trim().replace(/,/g, "").replace(/\u2212/g, "-");
  const match = value.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([KMBT])?\s*%?$/i);
  if (!match) return null;
  const factor: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  const result = Number(match[1]) * (factor[(match[2] ?? "").toUpperCase()] ?? 1);
  return Number.isFinite(result) ? result : null;
}

export function investingLondonTime(day: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{1,2}:\d{2}$/.test(time)) throw new Error(`Invalid calendar date/time: ${day} ${time}`);
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (hour > 23 || minute > 59) throw new Error(`Invalid calendar time: ${time}`);
  const desired = Date.UTC(year, month - 1, date, hour, minute);
  if (new Date(desired).toISOString().slice(0, 10) !== day) throw new Error(`Invalid calendar date: ${day}`);
  let timestamp = desired;
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
    timestamp += desired - Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  }
  return new Date(timestamp).toISOString();
}

export function investingForecastToMetricValue(metricId: string, value: number): number {
  return metricId === "us-initial-claims" || metricId === "us-continuing-claims" ? value : value * investingToCatalogScale(metricId);
}

export async function importInvestingCalendar(rows: Array<Record<string, unknown>>, dumpFile: string) {
  if (!rows.length) throw new Error("Capture contains no calendar rows");
  const client = getClient();
  const importedAt = new Date().toISOString();
  const statements = rows.map(row => {
    if (typeof row.date !== "string" || typeof row.time !== "string" || typeof row.event !== "string" || typeof row.country !== "string") throw new Error("Capture contains an invalid calendar row");
    const currency = typeof row.currency === "string" ? row.currency : null;
    const metricId = mapInvestingEvent({ eventName: row.event, country: row.country, currency });
    const raw = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
    return { sql: `INSERT INTO calendar_events (source,country,currency,event_name,importance,released_at,actual,forecast,previous,raw_actual,raw_forecast,raw_previous,metric_id,dump_file,imported_at) VALUES ('investing',?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,country,event_name,released_at) DO UPDATE SET currency=excluded.currency,importance=excluded.importance,actual=excluded.actual,forecast=excluded.forecast,previous=excluded.previous,raw_actual=excluded.raw_actual,raw_forecast=excluded.raw_forecast,raw_previous=excluded.raw_previous,metric_id=excluded.metric_id,dump_file=excluded.dump_file,imported_at=excluded.imported_at`, args: [row.country, currency, row.event, typeof row.importance === "number" ? row.importance : null, investingLondonTime(row.date, row.time), parseInvestingNumber(row.actual), parseInvestingNumber(row.forecast), parseInvestingNumber(row.previous), raw(row.actual), raw(row.forecast), raw(row.previous), metricId, dumpFile, importedAt] };
  });
  await client.batch(statements, "write");
  return { rows: rows.length, mapped: statements.filter(statement => statement.args[11] != null).length };
}
