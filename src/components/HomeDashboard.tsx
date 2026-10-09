"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { COUNTRY_META } from "@/catalog/hierarchy";
import { OverviewChart } from "./OverviewChart";
import { OverviewCalendar } from "./OverviewCalendar";
import { buildOverviewSeries, latestOverviewReading, OVERVIEW_METRICS, OVERVIEW_REGIONS, overviewPeriodLabel, overviewWindow, type OverviewIndicator, type OverviewPayload } from "@/lib/overview-data";
import { formatLiveSourceLabel } from "@/lib/live-source-label";

const INDICATORS: { id: OverviewIndicator; label: string; detail: string }[] = [
  { id: "inflation", label: "Inflation", detail: "CPI (US, UK) · HICP (Euro Area)" },
  { id: "gdp", label: "GDP growth", detail: "Quarter-on-quarter · seasonally adjusted" },
  { id: "unemployment", label: "Unemployment rate", detail: "Share of the labour force" },
];

export function HomeDashboard() {
  const [payload, setPayload] = useState<OverviewPayload>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/overview", { cache: "no-store", signal });
      if (!response.ok) throw new Error("Unable to load the overview. Please try again.");
      const data = await response.json() as OverviewPayload;
      if (signal?.aborted) return;
      setPayload(data);
      setNow(new Date());
      setError("");
    } catch (error) {
      if (signal?.aborted) return;
      setError(error instanceof Error ? error.message : "Overview unavailable.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => void load(controller.signal), 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [load]);
  const charts = useMemo(() => ({ inflation: buildOverviewSeries(payload, "inflation", now), gdp: buildOverviewSeries(payload, "gdp", now), unemployment: buildOverviewSeries(payload, "unemployment", now) }), [payload, now]);
  const chartWindow = overviewWindow(now);

  return <div className="overview-page">
    <header className="overview-heading"><div><h1>The macro picture.</h1><p>Key indicators for the United States, United Kingdom and Euro Area.</p></div><span className="overview-period">{chartWindow.label} · published data</span></header>
    {error && <div className="overview-error" role="status">{error} {Object.keys(payload).length > 0 && "Showing the last successfully loaded observations."} <button type="button" onClick={() => void load()}>Try again</button></div>}
    <section className="overview-comparison" id="country-comparison" aria-labelledby="overview-comparison-title" aria-busy={loading}>
      <div className="overview-comparison-scroll" tabIndex={0} role="region" aria-label="Three-country key indicator comparison">
        <table><thead><tr><th scope="col"><h2 id="overview-comparison-title">Key indicators</h2></th>{OVERVIEW_REGIONS.map(region => <th key={region} scope="col" data-country={region.toLowerCase()}><div className="overview-country-heading"><span className="overview-country-flag" aria-hidden="true">{COUNTRY_META[region].flag}</span><div><h3>{COUNTRY_META[region].name}</h3><Link href={`/country/${region.toLowerCase()}`}>Open country view →</Link></div></div></th>)}</tr></thead>
          <tbody>{INDICATORS.map(indicator => <tr key={indicator.id}><th scope="row"><strong>{indicator.label}</strong><span>{indicator.detail}</span></th>{OVERVIEW_REGIONS.map(region => {
            const reading = latestOverviewReading(payload, region, indicator.id, now);
            const metric = payload[OVERVIEW_METRICS[region][indicator.id]];
            const prefix = indicator.id === "inflation" ? `${region === "EA" ? "HICP" : "CPI"} · ` : "";
            return <td key={region} data-country={region.toLowerCase()}><div className="overview-reading"><strong>{loading ? "…" : reading ? `${reading.value.toFixed(1)}%` : "—"}</strong><span>{reading ? `${prefix}${overviewPeriodLabel(reading.date, indicator.id === "gdp")}` : loading ? "Loading…" : "No 2026 observation"}</span></div>{reading && <span className="overview-reading-source">{formatLiveSourceLabel(metric?.meta?.liveSource)}{region === "US" && indicator.id === "gdp" ? " · converted from SAAR" : ""}</span>}</td>;
          })}</tr>)}</tbody>
        </table>
      </div>
    </section>
    <OverviewChart indicator="inflation" data={charts.inflation} loading={loading} />
    <div className="overview-supporting-charts"><OverviewChart indicator="gdp" data={charts.gdp} loading={loading} /><OverviewChart indicator="unemployment" data={charts.unemployment} loading={loading} /></div>
    <OverviewCalendar />
    <footer className="overview-footer"><span>2026 observations only · charts end in the current month; publication schedules may lag.</span><span>Country views retain the original published series and full indicator breakdowns.</span></footer>
  </div>;
}
