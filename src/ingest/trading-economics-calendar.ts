import { getClient, getD1Database } from "@/db";
import { parseInvestingNumber } from "@/ingest/investing-calendar";

const EVENTS: Record<string, Record<string, string>> = {
  "United States": {
    "Initial Jobless Claims": "us-initial-claims", "Continuing Jobless Claims": "us-continuing-claims",
    "Non Farm Payrolls": "us-nfp", "Nonfarm Payrolls": "us-nfp", "Unemployment Rate": "us-unemployment",
    "Inflation Rate YoY": "us-cpi-yoy", "Inflation Rate MoM": "us-cpi-mom",
    "Core Inflation Rate YoY": "us-core-cpi-yoy", "Core Inflation Rate MoM": "us-core-cpi-mom",
    "Core PCE Price Index MoM": "us-core-pce-mom", "Core PCE Price Index YoY": "us-core-pce-yoy",
    "PCE Price Index MoM": "us-pce-mom", "PCE Price Index YoY": "us-pce-yoy",
    "Retail Sales MoM": "us-retail-sales", "Retail Sales Ex Autos MoM": "us-retail-sales-ex-auto",
    "PPI YoY": "us-ppi-final-demand", "PPI MoM": "us-ppi-final-demand-mom",
    "PPI Ex Food, Energy and Trade YoY": "us-ppi-core", "PPI Ex Food, Energy and Trade MoM": "us-ppi-core-mom",
    "Retail Sales Control Group MoM": "us-retail-sales-control-group",
    "Michigan Inflation Expectations Prel": "us-umich-inflation-exp-1y", "Michigan Inflation Expectations Final": "us-umich-inflation-exp-1y",
    "Michigan 5 Year Inflation Expectations Prel": "us-umich-inflation-exp-5y", "Michigan 5 Year Inflation Expectations Final": "us-umich-inflation-exp-5y",
    "ADP Employment Change": "us-adp-change", "JOLTs Job Openings": "us-jolts-openings",
    "Capacity Utilization": "us-capacity-utilization", "Industrial Production YoY": "us-industrial-production",
  },
  "United Kingdom": { "Inflation Rate YoY": "uk-cpi-yoy", "Inflation Rate MoM": "uk-cpi-mom", "Core Inflation Rate YoY": "uk-core-cpi-yoy", "Core Inflation Rate MoM": "uk-core-cpi-mom", "Unemployment Rate": "uk-unemployment", "DMP 1Y CPI Expectations": "uk-dmp-inflation-exp-1y", "PPI Input YoY": "uk-ppi-input-yoy", "PPI Input MoM": "uk-ppi-input-mom", "PPI Output YoY": "uk-ppi-output-yoy", "PPI Output MoM": "uk-ppi-output-mom" },
  "Euro Area": { "Inflation Rate YoY": "ea-hicp-yoy", "Inflation Rate YoY Flash": "ea-hicp-yoy", "Inflation Rate YoY Final": "ea-hicp-yoy", "Inflation Rate MoM": "ea-hicp-mom", "Inflation Rate MoM Flash": "ea-hicp-mom", "Inflation Rate MoM Final": "ea-hicp-mom", "Core Inflation Rate YoY Flash": "ea-core-hicp-yoy", "Core Inflation Rate YoY Final": "ea-core-hicp-yoy", "Unemployment Rate": "ea-unemployment" },
};
const REGIONS: Record<string, string> = { "United States": "US", "United Kingdom": "UK", "Euro Area": "EA" };
type SourceEvent = { CalendarId?: unknown; Country?: unknown; Event?: unknown; Date?: unknown; Forecast?: unknown; TEForecast?: unknown; DateSpan?: unknown };
export type TradingEconomicsEvent = { id: string; country: string; metricId: string; eventName: string; releasedAt: string; forecast: number | null; rawForecast: string | null };

export function normalizeTradingEconomicsEvent(row: SourceEvent): TradingEconomicsEvent | null {
  if (typeof row.Country !== "string" || typeof row.Event !== "string" || typeof row.Date !== "string" || row.CalendarId == null) return null;
  const metricId = EVENTS[row.Country]?.[row.Event];
  if (!metricId || Number(row.DateSpan ?? 0) !== 0) return null;
  const timestamp = /(?:Z|[+-]\d\d:\d\d)$/i.test(row.Date) ? row.Date : `${row.Date}Z`;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  const rawForecast = typeof row.Forecast === "string" && row.Forecast.trim() ? row.Forecast.trim() : typeof row.Forecast === "number" ? String(row.Forecast) : null;
  const forecast = rawForecast == null ? null : parseInvestingNumber(rawForecast.replace(/[$£€]/g, ""));
  return { id: String(row.CalendarId), country: REGIONS[row.Country], metricId, eventName: row.Event, releasedAt: date.toISOString(), forecast, rawForecast };
}

export async function fetchTradingEconomicsCalendar(key: string, now = new Date(), fetcher: typeof fetch = fetch) {
  if (!key.trim()) throw new Error("Trading Economics API key is not configured");
  const start = new Date(now.getTime() - 8 * 86400000).toISOString().slice(0, 10);
  const end = new Date(now.getTime() + 10 * 86400000).toISOString().slice(0, 10);
  const results = await Promise.all(Object.keys(REGIONS).map(async country => {
    const url = `https://api.tradingeconomics.com/calendar/country/${encodeURIComponent(country)}/${start}/${end}?f=json`;
    const response = await fetcher(url, { headers: { Authorization: key, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Trading Economics calendar returned HTTP ${response.status} for ${country}`);
    const data: unknown = await response.json();
    if (!Array.isArray(data) || data.length >= 1000) throw new Error(`Trading Economics calendar response invalid or truncated for ${country}`);
    return data.filter(row => row && typeof row === "object" && (row as SourceEvent).Country === country)
      .map(row => normalizeTradingEconomicsEvent(row as SourceEvent))
      .filter((row): row is TradingEconomicsEvent => row != null && row.releasedAt.slice(0, 10) >= start && row.releasedAt.slice(0, 10) <= end);
  }));
  const events = results.flat();
  if (!events.length) throw new Error("Trading Economics returned no mapped calendar events");
  return { events, start, end };
}

export async function refreshTradingEconomicsCalendar(key: string, now = new Date()) {
  const { events, start, end } = await fetchTradingEconomicsCalendar(key, now);
  const importedAt = now.toISOString();
  const sql = `INSERT INTO calendar_events (source,country,currency,event_name,released_at,forecast,raw_forecast,metric_id,dump_file,imported_at) VALUES ('tradingeconomics',?,?,?,?,?,?,?,?,?) ON CONFLICT(source,country,event_name,released_at) DO UPDATE SET forecast=excluded.forecast,raw_forecast=excluded.raw_forecast,metric_id=excluded.metric_id,imported_at=excluded.imported_at`;
  const statements = [
    { sql: "DELETE FROM calendar_events WHERE source = 'tradingeconomics' AND released_at >= ? AND released_at < ?", args: [`${start}T00:00:00.000Z`, `${end}T23:59:59.999Z`] },
    ...events.map(event => ({ sql, args: [event.country, event.country === "US" ? "USD" : event.country === "UK" ? "GBP" : "EUR", `${event.eventName} [TE:${event.id}]`, event.releasedAt, event.forecast, event.rawForecast, event.metricId, "trading-economics-api", importedAt] })),
  ];
  const database = getD1Database();
  if (database) await database.batch(statements.map(statement => database.prepare(statement.sql).bind(...statement.args)));
  else await getClient().batch(statements, "write");
  return { rows: events.length, forecasts: events.filter(event => event.forecast != null).length, importedAt, start, end };
}
