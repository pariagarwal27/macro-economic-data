"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { COUNTRY_META } from "@/catalog/hierarchy";
import { filterHistoryByYearRange, filterHistoryToTrailing12Months } from "@/lib/history-range";
import { buildOverviewInflationSeries, OVERVIEW_INFLATION_SERIES, overviewAxisDomain, type OverviewInflationMode, type OverviewPayload } from "@/lib/overview-data";
import { getNiceTicks } from "@/lib/chart-axis";
import { HistoryChartViewport } from "./HistoryChartViewport";

const color = (region: string) => `var(--country-${region.toLowerCase()})`;

export function InflationOverviewChart({ payload, loading }: { payload: OverviewPayload; loading: boolean }) {
  const [mode, setMode] = useState<OverviewInflationMode>("yoy");
  const [showHeadline, setShowHeadline] = useState(true);
  const [showCore, setShowCore] = useState(false);
  const allData = useMemo(() => buildOverviewInflationSeries(payload, mode), [payload, mode]);
  const series = OVERVIEW_INFLATION_SERIES.filter(item => item.kind === "headline" ? showHeadline : showCore);
  const hasSelection = showHeadline || showCore;

  return <figure className="overview-chart overview-chart-inflation" aria-labelledby="overview-chart-inflation">
    <figcaption className="overview-chart-heading">
      <div><h2 id="overview-chart-inflation">Inflation</h2><p>CPI (US, UK) · HICP (Euro Area)</p></div>
      <div className="overview-chart-legend" aria-label="Selected inflation series">
        {series.map(item => <span key={item.key}><i className={item.kind === "core" ? "is-core" : ""} style={{ borderColor: color(item.region), background: item.kind === "core" ? "transparent" : color(item.region) }} aria-hidden="true" />{COUNTRY_META[item.region].name} ({item.metricLabel})</span>)}
      </div>
    </figcaption>
    <div className="overview-inflation-controls">
      <div className="overview-inflation-series" role="group" aria-label="Inflation measures">
        <label><input type="checkbox" checked={showHeadline} onChange={event => setShowHeadline(event.target.checked)} />Headline</label>
        <label><input type="checkbox" checked={showCore} onChange={event => setShowCore(event.target.checked)} />Core</label>
      </div>
      <div className="overview-inflation-period" role="group" aria-label="Inflation change period">
        <button type="button" aria-pressed={mode === "yoy"} onClick={() => setMode("yoy")}>YoY</button>
        <button type="button" aria-pressed={mode === "mom"} onClick={() => setMode("mom")}>MoM</button>
      </div>
    </div>
    <div className="overview-chart-unit">{mode === "yoy" ? "Year-on-year change (%)" : "Month-on-month change (%)"}</div>
    <HistoryChartViewport dates={allData.map(point => point.period)} label="Inflation comparison" height={290}>
      {(_plotWidth, fromYear, toYear, isDefaultWindow) => {
        const data = isDefaultWindow ? filterHistoryToTrailing12Months(allData) : filterHistoryByYearRange(allData, fromYear, toYear);
        const values = data.flatMap(point => series.map(item => point[item.key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
        const ticks = getNiceTicks(values.length ? [Math.min(...values), Math.max(...values)] : [0, 1], 9, 0.1);
        return <div className="overview-chart-plot">
          {loading ? <div className="overview-chart-empty">Loading published observations…</div> : !hasSelection ? <div className="overview-chart-empty">Select Headline or Core to plot inflation.</div> : !values.length ? <div className="overview-chart-empty">No published inflation observations available for this period.</div> : <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={data} margin={{ top: 12, right: 16, bottom: 6, left: 0 }} accessibilityLayer>
              <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 4" />
              <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={18} />
              <YAxis domain={overviewAxisDomain(ticks)} ticks={ticks} allowDataOverflow tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={false} width={46} tickFormatter={value => `${Number(value).toFixed(1)}%`} />
              <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", fontSize: 12, borderRadius: 2 }} labelStyle={{ color: "var(--ink)", fontWeight: 600 }} formatter={(value, name) => [`${Number(value).toFixed(1)}%`, name]} filterNull />
              {series.map(item => <Line key={item.key} dataKey={item.key} name={`${COUNTRY_META[item.region].name} · ${item.metricLabel}`} type="linear" stroke={color(item.region)} strokeWidth={item.kind === "core" ? 1.8 : 2.2} strokeDasharray={item.kind === "core" ? "5 3" : undefined} dot={{ r: 2.3, strokeWidth: 0, fill: color(item.region) }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>}
        </div>;
      }}
    </HistoryChartViewport>
    <p className="overview-chart-note">Published annual or monthly rates. CPI and HICP use different basket methodologies; missing observations remain gaps.</p>
  </figure>;
}
