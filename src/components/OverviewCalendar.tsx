"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { COUNTRY_META } from "@/catalog/hierarchy";
import { formatMatrixValue } from "@/lib/format";
import { formatRawCalendarValue, formatUtcTime } from "@/lib/calendar-tape";
import type { OverviewRegion } from "@/lib/overview-data";

type CalendarEvent = {
  releasedAt: string; eventName: string; country: string; tapeRegion: string;
  metricId: string | null; unit: string | null; status: "upcoming" | "released";
  previous: number | null; forecast: number | null; actual: number | null;
  rawPrevious: string | null; rawForecast: string | null; rawActual: string | null;
};
const londonDay = (date: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date));
const dayHeading = (date: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(date));
function calendarValue(event: CalendarEvent, field: "actual" | "forecast" | "previous") {
  if (field === "actual" && event.status !== "released") return "—";
  const value = event[field];
  const raw = event[field === "actual" ? "rawActual" : field === "forecast" ? "rawForecast" : "rawPrevious"];
  return value != null && event.unit ? formatMatrixValue(value, event.unit) : formatRawCalendarValue(value, raw);
}

export function OverviewCalendar() {
  const [view, setView] = useState<"upcoming" | "history">("upcoming");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/calendar?days=7&kind=data&forwardOnly=true&pastOnly=${view === "history"}`, { cache: "no-store", signal });
      if (!response.ok) throw new Error("Unable to load economic releases.");
      const payload = await response.json() as { events: CalendarEvent[] };
      if (signal?.aborted) return;
      setEvents(payload.events.filter(event => ["US", "UK", "EA"].includes(event.tapeRegion)).sort((a, b) => view === "history" ? b.releasedAt.localeCompare(a.releasedAt) : a.releasedAt.localeCompare(b.releasedAt)));
      setError("");
    } catch (error) {
      if (signal?.aborted) return;
      setError(error instanceof Error ? error.message : "Calendar unavailable.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [view]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => void load(controller.signal), 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [load]);

  return <section className="overview-calendar" aria-labelledby="overview-calendar-title">
    <div className="overview-calendar-heading">
      <div><h2 id="overview-calendar-title">Economic calendar</h2><p>{view === "upcoming" ? "Next seven days" : "Previous seven days"} · all times are London time (BST/GMT).</p></div>
      <div className="overview-calendar-controls" role="group" aria-label="Calendar view">
        {(["upcoming", "history"] as const).map(mode => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => { if (mode !== view) { setView(mode); setEvents([]); setLoading(true); } }}>{mode === "upcoming" ? "Upcoming" : "History"}</button>)}
      </div>
    </div>
    {error ? <div className="overview-error" role="status">{error} <button type="button" onClick={() => { setLoading(true); void load(); }}>Try again</button></div> : loading ? <div className="overview-calendar-empty" role="status">Loading releases…</div> : events.length === 0 ? <div className="overview-calendar-empty">No {view === "history" ? "historical" : "upcoming"} data releases are available in this seven-day window. <Link href="/calendar">Open the full calendar →</Link></div> : <div className="overview-calendar-table-wrap" tabIndex={0} role="region" aria-label="Economic release table">
      <table><thead><tr><th scope="col">Date</th><th scope="col">Time (London)</th><th scope="col">Country</th><th scope="col">Release</th><th scope="col">Previous</th><th scope="col">Forecast</th><th scope="col">Actual</th><th scope="col">Status</th></tr></thead>
        <tbody>{events.map((event, index) => {
          const region = event.tapeRegion as OverviewRegion;
          const day = londonDay(event.releasedAt);
          return <Fragment key={`${event.releasedAt}-${event.country}-${event.eventName}-${index}`}>
            {(index === 0 || londonDay(events[index - 1].releasedAt) !== day) && <tr className="overview-calendar-day"><th colSpan={8} scope="rowgroup">{dayHeading(event.releasedAt)}</th></tr>}
            <tr>
              <td>{new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" }).format(new Date(event.releasedAt))}</td>
              <td>{formatUtcTime(event.releasedAt)}</td>
              <td><span className="overview-country-label" data-country={region.toLowerCase()}><span aria-hidden="true">{COUNTRY_META[region].flag}</span>{COUNTRY_META[region].name}</span></td>
              <td>{event.metricId ? <Link href={`/metrics/${event.metricId}`}>{event.eventName}</Link> : event.eventName}</td>
              <td>{calendarValue(event, "previous")}</td><td>{calendarValue(event, "forecast")}</td><td>{calendarValue(event, "actual")}</td>
              <td><span className={`overview-release-status ${event.status}`}>{event.status === "released" ? "Released" : view === "history" ? "Pending" : "Upcoming"}</span></td>
            </tr>
          </Fragment>;
        })}</tbody>
      </table>
    </div>}
    <div className="overview-calendar-footer"><span>Previous, forecast and actual values use each release’s published units.</span><Link href="/calendar">Full economic calendar →</Link></div>
  </section>;
}
