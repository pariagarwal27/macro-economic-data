import { getClient, getD1Database } from "@/db";
import { parseInvestingNumber } from "@/ingest/investing-calendar";
import { mapInvestingEvent } from "@/catalog/investing-map";

const METRICS: Record<string, Record<string, string>> = {
  USD: {
    "Initial Jobless Claims": "us-initial-claims", "Continuing Jobless Claims": "us-continuing-claims",
    "Non Farm Payrolls": "us-nfp", "Nonfarm Payrolls": "us-nfp", "Unemployment Rate": "us-unemployment",
    "Inflation Rate YoY": "us-cpi-yoy", "Inflation Rate MoM": "us-cpi-mom",
    "Core Inflation Rate YoY": "us-core-cpi-yoy", "Core Inflation Rate MoM": "us-core-cpi-mom",
    "Core PCE Price Index MoM": "us-core-pce-mom", "Core PCE Price Index YoY": "us-core-pce-yoy",
    "PCE Price Index MoM": "us-pce-mom", "PCE Price Index YoY": "us-pce-yoy",
    "Retail Sales MoM": "us-retail-sales", "Retail Sales Ex Autos MoM": "us-retail-sales-ex-auto",
    "Retail Sales Control Group MoM": "us-retail-sales-control-group",
    "Producer Price Index YoY": "us-ppi-final-demand", "Producer Price Index MoM": "us-ppi-final-demand-mom",
    "Producer Price Index ex Food & Energy YoY": "us-ppi-core", "Producer Price Index ex Food & Energy MoM": "us-ppi-core-mom",
    "JOLTs Job Openings": "us-jolts-openings", "ADP Employment Change": "us-adp-change",
    "Capacity Utilization": "us-capacity-utilization", "Industrial Production YoY": "us-industrial-production",
  },
  GBP: {
    "Inflation Rate YoY": "uk-cpi-yoy", "Inflation Rate MoM": "uk-cpi-mom",
    "Core Inflation Rate YoY": "uk-core-cpi-yoy", "Core Inflation Rate MoM": "uk-core-cpi-mom",
    "Unemployment Rate": "uk-unemployment", "Retail Sales MoM": "uk-retail-sales-mom",
    "PPI Input YoY": "uk-ppi-input-yoy", "PPI Input MoM": "uk-ppi-input-mom",
    "PPI Output YoY": "uk-ppi-output-yoy", "PPI Output MoM": "uk-ppi-output-mom",
  },
  EUR: {
    "Harmonized Index of Consumer Prices YoY": "ea-hicp-yoy",
    "Harmonized Index of Consumer Prices MoM": "ea-hicp-mom",
    "Core Harmonized Index of Consumer Prices YoY": "ea-core-hicp-yoy",
    "Unemployment Rate": "ea-unemployment",
    "Gross Domestic Product s.a. YoY": "ea-gdp-yoy", "Gross Domestic Product s.a. QoQ": "ea-gdp-qoq",
    "Gross Domestic Product s.a YoY": "ea-gdp-yoy", "Gross Domestic Product s.a QoQ": "ea-gdp-qoq",
  },
};
const COUNTRY: Record<string, string> = { USD: "US", GBP: "UK", EUR: "EA" };

export type FreeConsensusEvent = {
  id: string; currency: string; metricId: string; eventName: string;
  releasedAt: string; forecast: number | null; rawForecast: string | null;
};
type SourceEvent = { id?: unknown; currency?: unknown; title?: unknown; time?: unknown; ts?: unknown; status?: unknown; forecast?: unknown };

export function normalizeFreeConsensusEvent(row: SourceEvent): FreeConsensusEvent | null {
  if (typeof row.currency !== "string" || typeof row.title !== "string") return null;
  const currency = row.currency.toUpperCase();
  const title = row.title.trim();
  // Euro Area-wide titles may carry an (EA)/(EU) qualifier; national EUR
  // entries such as (ES) and (FR) must never be treated as area-wide data.
  if (currency === "EUR" && /\(([A-Z]{2,3})\)\s*$/.test(title) && !/\((?:EA|EU|EMU)\)\s*$/.test(title)) return null;
  const canonicalTitle = title.replace(/\s+\((?:EA|EU|EMU)\)\s*$/i, "");
  const metricId = METRICS[currency]?.[canonicalTitle] ?? mapInvestingEvent({ eventName: canonicalTitle, country: COUNTRY[currency] ?? "OTHER", currency });
  if (!metricId || typeof row.status === "string" && /tentative|cancel|holiday/i.test(row.status)) return null;
  const time = typeof row.time === "string" ? row.time : typeof row.ts === "string" ? row.ts : null;
  if (!time) return null;
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return null;
  const rawForecast = typeof row.forecast === "string" && row.forecast.trim()
    ? row.forecast.trim()
    : typeof row.forecast === "number" ? String(row.forecast) : null;
  const forecast = rawForecast == null ? null : parseInvestingNumber(rawForecast.replace(/[$£€]/g, ""));
  return { id: String(row.id ?? `${currency}-${title}-${date.toISOString()}`), currency, metricId, eventName: title, releasedAt: date.toISOString(), forecast, rawForecast };
}

export async function fetchFreeConsensus(fetcher: typeof fetch = fetch, now = new Date()) {
  const url = new URL("https://showmytrades.com/api/public/calendar/v1");
  url.searchParams.set("currency", "USD,EUR,GBP");
  url.searchParams.set("impact", "all");
  url.searchParams.set("days", "8");
  const response = await fetcher(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Free economic calendar returned HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !Array.isArray((data as { events?: unknown }).events)) throw new Error("Free economic calendar response is invalid");
  const events = ((data as { events: unknown[] }).events)
    .filter((row): row is SourceEvent => Boolean(row && typeof row === "object"))
    .map(normalizeFreeConsensusEvent).filter((row): row is FreeConsensusEvent => row != null);
  if (!events.length) throw new Error("Free economic calendar returned no mapped releases");
  const start = new Date(now.getTime() - 6 * 3600000).toISOString().slice(0, 10);
  const end = new Date(now.getTime() + 8 * 86400000).toISOString().slice(0, 10);
  return { events, start, end };
}

export async function refreshFreeConsensus(now = new Date()) {
  const { events, start, end } = await fetchFreeConsensus(fetch, now);
  const importedAt = now.toISOString();
  const refreshStart = new Date(now.getTime() - 6 * 3600000).toISOString();
  const refreshEnd = new Date(now.getTime() + 8 * 86400000).toISOString();
  const sql = `INSERT INTO calendar_events (source,country,currency,event_name,released_at,forecast,raw_forecast,metric_id,dump_file,imported_at) VALUES ('showmytrades',?,?,?,?,?,?,?,?,?) ON CONFLICT(source,country,event_name,released_at) DO UPDATE SET forecast=excluded.forecast,raw_forecast=excluded.raw_forecast,metric_id=excluded.metric_id,imported_at=excluded.imported_at`;
  const statements = [
    { sql: "DELETE FROM calendar_events WHERE source = 'showmytrades' AND released_at >= ? AND released_at < ?", args: [refreshStart, refreshEnd] },
    ...events.map(event => ({ sql, args: [COUNTRY[event.currency], event.currency, `${event.eventName} [SMT:${event.id}]`, event.releasedAt, event.forecast, event.rawForecast, event.metricId, "showmytrades-public-calendar", importedAt] })),
  ];
  const database = getD1Database();
  if (database) await database.batch(statements.map(statement => database.prepare(statement.sql).bind(...statement.args)));
  else await getClient().batch(statements, "write");
  return { rows: events.length, forecasts: events.filter(event => event.forecast != null).length, importedAt, start, end };
}
