"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { COUNTRY_META } from "@/catalog/hierarchy";
import { OverviewChart } from "./OverviewChart";
import { InflationOverviewChart } from "./InflationOverviewChart";
import { ExpectationsOverviewChart } from "./ExpectationsOverviewChart";
import { EconomicCalendarSidebar } from "./EconomicCalendarSidebar";
import { buildOverviewSeries, latestOverviewInflationMovement, latestOverviewMovement, OVERVIEW_METRICS, OVERVIEW_REGIONS, overviewPeriodLabel, overviewWindow, type OverviewIndicator, type OverviewPayload } from "@/lib/overview-data";
import { formatLiveSourceLabel } from "@/lib/live-source-label";

const INDICATORS: { id: OverviewIndicator; label: string; detail: string }[] = [
  { id: "inflation", label: "Inflation", detail: "CPI (US, UK) · HICP (Euro Area)" },
  { id: "gdp", label: "GDP growth", detail: "Quarter-on-quarter · seasonally adjusted" },
  { id: "unemployment", label: "Unemployment rate", detail: "Share of the labour force" },
  { id: "wage", label: "Wage growth", detail: "Annual pay growth · source definitions vary" },
];
const CORE_INFLATION_METRICS = { US: "us-cpi-core", UK: "uk-core-cpi-yoy", EA: "ea-core-hicp-yoy" } as const;

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
  const charts = useMemo(() => ({ gdp: buildOverviewSeries(payload, "gdp", now), unemployment: buildOverviewSeries(payload, "unemployment", now), wage: buildOverviewSeries(payload, "wage", now) }), [payload, now]);
  const chartWindow = overviewWindow(now, payload);

  return <div className="overview-page">
    <div className="overview-main">
    <header className="overview-heading"><span className="overview-period">{chartWindow.label} · published data</span></header>
    {error && <div className="overview-error" role="status">{error} {Object.keys(payload).length > 0 && "Showing the last successfully loaded observations."} <button type="button" onClick={() => void load()}>Try again</button></div>}
    <section className="overview-comparison" id="country-comparison" aria-labelledby="overview-comparison-title" aria-busy={loading}>
      <div className="overview-comparison-scroll" tabIndex={0} role="region" aria-label="Three-country key indicator comparison">
        <table><thead><tr><th scope="col"><h2 id="overview-comparison-title">Key indicators</h2></th>{OVERVIEW_REGIONS.map(region => <th key={region} scope="col" data-country={region.toLowerCase()}><div className="overview-country-heading"><span className="overview-country-flag" aria-hidden="true">{COUNTRY_META[region].flag}</span><div><h3>{COUNTRY_META[region].name}</h3><Link href={`/country/${region.toLowerCase()}`}>Open country view →</Link></div></div></th>)}</tr></thead>
          <tbody>{INDICATORS.map(indicator => <tr key={indicator.id}><th scope="row"><strong>{indicator.label}</strong><span>{indicator.detail}</span></th>{OVERVIEW_REGIONS.map(region => {
            const reading = latestOverviewMovement(payload, indicator.id, region, now);
            const metric = payload[OVERVIEW_METRICS[region][indicator.id]];
            const period = reading ? overviewPeriodLabel(reading.date, indicator.id === "gdp" || indicator.id === "wage" && region === "EA") : "";
            const formatValue = (value: number | null | undefined) => value == null ? "—" : `${value.toFixed(1)}%`;
            const cue = (value: number | null, label: string) => {
              const direction = value == null || Math.abs(value) < 0.05 ? "flat" : value > 0 ? "up" : "down";
              const signal = direction === "flat" ? "flat" : (indicator.id === "gdp" ? value! > 0 : value! < 0) ? "favorable" : "unfavorable";
              const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
              const formatted = value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}pp`;
              return <span className="overview-change-cue" data-signal={signal} aria-label={`${direction} ${formatted} ${label}`}><b aria-hidden="true">{arrow}</b>{formatted}</span>;
            };
            if (indicator.id === "inflation") {
              const coreReading = latestOverviewInflationMovement(payload, region, "core", now);
              const coreMetric = payload[CORE_INFLATION_METRICS[region]];
              const renderInflationPair = (kind: "Headline" | "Core", current: typeof reading, source: typeof metric) => {
                const currentPeriod = current ? overviewPeriodLabel(current.date) : "";
                return <div className="overview-inflation-reading-block" key={kind}>
                  <span className="overview-inflation-kind">{kind}</span>
                  <div className="overview-reading-pair">
                    <div><span>{current?.primaryLabel ?? (loading ? "Loading…" : "YoY")}</span><div className="overview-reading-value"><strong>{loading ? "…" : formatValue(current?.primary ?? null)}</strong>{current && cue(current.primaryChange, current.primaryChangeLabel)}</div></div>
                    <div><span>{current?.secondaryLabel ?? (loading ? "Loading…" : "MoM")}</span><div className="overview-reading-value"><strong>{loading ? "…" : formatValue(current?.secondary ?? null)}</strong>{current && cue(current.secondaryChange, current.secondaryChangeLabel)}</div></div>
                  </div>
                  {current && <span className="overview-reading-source">{currentPeriod ? `${currentPeriod} · ` : ""}{formatLiveSourceLabel(source?.meta?.liveSource)}</span>}
                </div>;
              };
              return <td key={region} data-country={region.toLowerCase()} className="overview-inflation-cell">
                {renderInflationPair("Headline", reading, metric)}
                {renderInflationPair("Core", coreReading, coreMetric)}
              </td>;
            }
            return <td key={region} data-country={region.toLowerCase()}>
              <div className="overview-reading-pair">
                <div><span>{reading?.primaryLabel ?? (loading ? "Loading…" : "No published observation")}</span><div className="overview-reading-value"><strong>{loading ? "…" : formatValue(reading?.primary ?? null)}</strong>{reading && cue(reading.primaryChange, reading.primaryChangeLabel)}</div></div>
                <div><span>{reading?.secondaryLabel ?? (loading ? "Loading…" : "No prior observation")}</span><div className="overview-reading-value"><strong>{loading ? "…" : formatValue(reading?.secondary ?? null)}</strong>{reading && cue(reading.secondaryChange, reading.secondaryChangeLabel)}</div></div>
              </div>
              {reading && <span className="overview-reading-source">{period ? `${period} · ` : ""}{formatLiveSourceLabel(metric?.meta?.liveSource)}{region === "US" && indicator.id === "gdp" ? " · converted from SAAR" : indicator.id === "wage" && region === "EA" ? " · quarterly" : ""}</span>}
            </td>;
          })}</tr>)}</tbody>
        </table>
      </div>
    </section>
    <InflationOverviewChart payload={payload} loading={loading} />
    <div className="overview-supporting-charts"><OverviewChart indicator="gdp" data={charts.gdp} loading={loading} /><OverviewChart indicator="unemployment" data={charts.unemployment} loading={loading} /></div>
    <div className="overview-wage-expectations">
      <OverviewChart indicator="wage" data={charts.wage} loading={loading} />
      <ExpectationsOverviewChart payload={payload} loading={loading} />
    </div>
    <footer className="overview-footer"><span>Charts default to the latest rolling 12 months of published data; release schedules may lag.</span><span>Country views retain the original published series and full indicator breakdowns.</span></footer>
    </div>
    <aside className="overview-release-sidebar" aria-label="Economic release diary">
      <EconomicCalendarSidebar onReleaseSelect={event => {
        if (event.region === "US" || event.region === "UK" || event.region === "EA") {
          window.location.assign(`/country/${event.region.toLowerCase()}?openMetric=${encodeURIComponent(event.metricId)}`);
        }
      }} />
    </aside>
  </div>;
}
