"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { COUNTRY_META } from "@/catalog/hierarchy";
import { OverviewChart } from "./OverviewChart";
import { InflationOverviewChart } from "./InflationOverviewChart";
import { ExpectationsOverviewChart } from "./ExpectationsOverviewChart";
import { EconomicCalendarSidebar } from "./EconomicCalendarSidebar";
import { buildOverviewSeries, latestOverviewInflationMovement, latestOverviewMovement, OVERVIEW_METRICS, OVERVIEW_REGIONS, overviewPeriodLabel, type OverviewIndicator, type OverviewPayload } from "@/lib/overview-data";
import { formatLiveSourceLabel } from "@/lib/live-source-label";
import { getClientJsonCache, refreshClientJson } from "@/lib/client-json-cache";

const INDICATORS: { id: OverviewIndicator; label: string; detail: string }[] = [
  { id: "inflation", label: "Inflation", detail: "CPI (US, UK) · HICP (Euro Area)" },
  { id: "gdp", label: "GDP growth", detail: "Quarter-on-quarter · seasonally adjusted" },
  { id: "unemployment", label: "Unemployment rate", detail: "Share of the labour force" },
  { id: "wage", label: "Wage growth", detail: "Annual pay growth · source definitions vary" },
  { id: "retail", label: "Retail sales", detail: "" },
];
const CORE_INFLATION_METRICS = { US: "us-cpi-core", UK: "uk-core-cpi-yoy", EA: "ea-core-hicp-yoy" } as const;

export function HomeDashboard() {
  const router = useRouter();
  const [selectedIndicator, setSelectedIndicator] = useState<OverviewIndicator>("inflation");
  const [overviewRun, setOverviewRun] = useState(0);
  const [showExpectations, setShowExpectations] = useState(false);
  const [payload, setPayload] = useState<OverviewPayload>(() => getClientJsonCache<OverviewPayload>("overview", false) ?? {});
  const [loading, setLoading] = useState(() => getClientJsonCache<OverviewPayload>("overview", false) == null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const load = useCallback(async (isActive: () => boolean = () => true) => {
    try {
      const data = await refreshClientJson<OverviewPayload>("overview", "/api/overview", "Unable to load the overview. Please try again.");
      if (!isActive()) return;
      setPayload(data);
      setNow(new Date());
      setError("");
    } catch (error) {
      if (!isActive()) return;
      setError(error instanceof Error ? error.message : "Overview unavailable.");
    } finally {
      if (isActive()) setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    const saved = getClientJsonCache<OverviewPayload>("overview");
    if (saved) { setPayload(saved); setLoading(false); }
    void load(() => active);
    const timer = window.setInterval(() => void load(() => active), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [load]);
  const charts = useMemo(() => ({ gdp: buildOverviewSeries(payload, "gdp", now), unemployment: buildOverviewSeries(payload, "unemployment", now), wage: buildOverviewSeries(payload, "wage", now), retail: buildOverviewSeries(payload, "retail", now) }), [payload, now]);

  return <div className="overview-page">
    <div className="overview-main">
    {error && <div className="overview-error" role="status">{error} {Object.keys(payload).length > 0 && "Showing the last successfully loaded observations."} <button type="button" onClick={() => void load()}>Try again</button></div>}
    <section className="overview-comparison" id="country-comparison" aria-labelledby="overview-comparison-title" aria-busy={loading}>
      <div className="overview-comparison-scroll" tabIndex={0} role="region" aria-label="Three-country key indicator comparison">
        <table><thead><tr><th scope="col"><h2 id="overview-comparison-title">Key indicators</h2></th>{OVERVIEW_REGIONS.map(region => <th key={region} scope="col" data-country={region.toLowerCase()}><div className="overview-country-heading"><span className="overview-country-flag" aria-hidden="true">{COUNTRY_META[region].flag}</span><div><h3>{COUNTRY_META[region].name}</h3><Link href={`/country/${region.toLowerCase()}`}>Open country view →</Link></div></div></th>)}</tr></thead>
          <tbody>{INDICATORS.map(indicator => <tr key={indicator.id} data-selected={selectedIndicator === indicator.id}><th scope="row"><button type="button" className="overview-indicator-select" aria-pressed={selectedIndicator === indicator.id} aria-controls="overview-selected-chart" onClick={() => { setSelectedIndicator(indicator.id); setOverviewRun(run => run + 1); setShowExpectations(false); }}><strong>{indicator.label}</strong>{indicator.detail && <span>{indicator.detail}</span>}</button></th>{OVERVIEW_REGIONS.map(region => {
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
              <div className={`overview-reading-pair${indicator.id === "retail" ? " overview-reading-single" : ""}`}>
                <div><span>{reading?.primaryLabel ?? (loading ? "Loading…" : "No published observation")}</span><div className="overview-reading-value"><strong>{loading ? "…" : formatValue(reading?.primary ?? null)}</strong>{reading && cue(reading.primaryChange, reading.primaryChangeLabel)}</div></div>
                {indicator.id !== "retail" && <div><span>{reading?.secondaryLabel ?? (loading ? "Loading…" : "No prior observation")}</span><div className="overview-reading-value"><strong>{loading ? "…" : formatValue(reading?.secondary ?? null)}</strong>{reading && cue(reading.secondaryChange, reading.secondaryChangeLabel)}</div></div>}
              </div>
              {reading && <span className="overview-reading-source">{period ? `${period} · ` : ""}{formatLiveSourceLabel(metric?.meta?.liveSource)}{region === "US" && indicator.id === "gdp" ? " · converted from SAAR" : indicator.id === "wage" && region === "EA" ? " · quarterly" : ""}</span>}
            </td>;
          })}</tr>)}</tbody>
        </table>
      </div>
    </section>
    <section id="overview-selected-chart" className="overview-selected-chart" aria-live="polite" aria-label={`${INDICATORS.find(item => item.id === selectedIndicator)?.label ?? "Selected indicator"} chart`}>
      {selectedIndicator === "inflation" && showExpectations ? <ExpectationsOverviewChart key={`expectations-${overviewRun}`} payload={payload} loading={loading} onBack={() => setShowExpectations(false)} /> : selectedIndicator === "inflation" ? <InflationOverviewChart key={`inflation-${overviewRun}`} payload={payload} loading={loading} onShowExpectations={() => setShowExpectations(true)} /> : <OverviewChart key={`${selectedIndicator}-${overviewRun}`} indicator={selectedIndicator} data={charts[selectedIndicator]} loading={loading} />}
    </section>
    <footer className="overview-footer"><span>Charts default to the latest rolling 12 months of published data; release schedules may lag.</span><span>Country views retain the original published series and full indicator breakdowns.</span></footer>
    </div>
    <aside className="overview-release-sidebar" aria-label="Economic release diary">
      <EconomicCalendarSidebar onReleaseSelect={event => {
        if (event.region === "US" || event.region === "UK" || event.region === "EA") {
          router.push(`/country/${event.region.toLowerCase()}?openMetric=${encodeURIComponent(event.metricId)}`);
        }
      }} />
    </aside>
  </div>;
}
