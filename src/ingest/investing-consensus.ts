import { mapInvestingEvent } from "@/catalog/investing-map";
import { executeSql, getClient } from "@/db";
import { investingLondonTime, parseInvestingNumber } from "@/ingest/investing-calendar";

type Event = { country: string; currency: string | null; event: string; releasedAt: string; metricId: string; forecast: number; rawForecast: string };

export function consensusArchiveStatements(events: Event[], capturedAt: string) {
  return events.map(e => ({
    sql: "INSERT OR IGNORE INTO nfp_consensus_archive (source,country,event_name,released_at,metric_id,forecast,raw_forecast,captured_at) VALUES ('investing',?,?,?,?,?,?,?)",
    args: [e.country, e.event, e.releasedAt, e.metricId, e.forecast, e.rawForecast, capturedAt],
  }));
}

export function normalizeInvestingConsensus(body: unknown, date: string) {
  if (!body || typeof body !== "object") throw new Error("Invalid collector response");
  const data = body as { complete?: unknown; date?: unknown; rows?: unknown };
  if (data.complete !== true || data.date !== date || !Array.isArray(data.rows)) throw new Error("Incomplete collector response");
  const events: Event[] = [];
  for (const input of data.rows) {
    if (!input || typeof input !== "object") throw new Error("Invalid collector row");
    const row = input as Record<string, unknown>;
    if (row.date !== date || typeof row.time !== "string" || typeof row.country !== "string" || typeof row.event !== "string") throw new Error("Invalid collector row date or identity");
    const currency = typeof row.currency === "string" ? row.currency : null;
    const metricId = mapInvestingEvent({ eventName: row.event, country: row.country, currency });
    if (!metricId || row.forecast == null || row.forecast === "" || row.forecast === "-") continue;
    const forecast = parseInvestingNumber(row.forecast);
    if (forecast == null) throw new Error("Invalid forecast value");
    events.push({ country: row.country, currency, event: row.event, releasedAt: investingLondonTime(date, row.time), metricId, forecast, rawForecast: String(row.forecast) });
  }
  return { date, events };
}

export async function persistInvestingConsensus(batches: Array<{ date: string; events: Event[] }>, today: string) {
  const events = batches.flatMap(batch => batch.events);
  const importedAt = new Date().toISOString();
  await executeSql(`CREATE TABLE IF NOT EXISTS nfp_consensus_archive (
    source TEXT NOT NULL, country TEXT NOT NULL, event_name TEXT NOT NULL, released_at TEXT NOT NULL,
    metric_id TEXT NOT NULL, forecast REAL NOT NULL, raw_forecast TEXT NOT NULL, captured_at TEXT NOT NULL,
    UNIQUE(source,country,event_name,released_at,captured_at)
  )`);
  const sql = `INSERT INTO calendar_events (source,country,currency,event_name,released_at,forecast,raw_forecast,metric_id,dump_file,imported_at) VALUES ('investing',?,?,?,?,?,?,?,?,?) ON CONFLICT(source,country,event_name,released_at) DO UPDATE SET forecast=excluded.forecast,raw_forecast=excluded.raw_forecast,metric_id=excluded.metric_id,imported_at=excluded.imported_at`;
  const statements = [...consensusArchiveStatements(events, importedAt), ...events.map(e => ({ sql, args: [e.country, e.currency, e.event, e.releasedAt, e.forecast, e.rawForecast, e.metricId, "investing-consensus-collector", importedAt] }))];
  if (statements.length) await getClient().batch(statements, "write");
  return { date: today, dates: batches.map(batch => batch.date), forecasts: events.length, importedAt };
}
